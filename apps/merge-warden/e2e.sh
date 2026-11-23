#!/usr/bin/env bash
# End-to-end verification for the merge-warden GitHub App.
#
# Opens real PRs in the sandbox repo and asserts the app's verdict check,
# approval, and merge for each scenario: a low-risk change merges once CI
# is green, a one-way-door path and the one-way-door label are never
# approved or merged, no-auto-merge stops a success verdict, red CI blocks
# until a fixing commit, a red CI run superseded by a green one on the same
# commit does not block the merge, and a PR off the default branch gets no
# check at all.
#
# Requires: gh (authenticated as the sandbox owner, the default `authors`),
# the app installed on the sandbox repo, and the sandbox prepared with the
# e2e-ci workflow and .github/merge-warden.yml (see the e2e skill).
#
# Every grade is a live model call, so a low-risk scenario can fail if the
# model reports confidence under 90 — the check run's summary says so.
#
# E2E_HOSTED=1 asserts against the deployed app (E2E_TARGET_URL overrides
# the URL) and tests the deployed code, not the working tree. Otherwise the
# script builds and starts a local server (.env with a dev app's
# credentials and ANTHROPIC_API_KEY), or reuses one already on :3000.
#
# Open PRs and their branches are cleaned up on exit (pass or fail);
# merged PRs and the files they added stay in the sandbox history.
set -euo pipefail
cd "$(dirname "$0")"

REPO="${E2E_REPO:-bostonaholic/merge-warden-sandbox}"
POLL_TIMEOUT="${E2E_POLL_TIMEOUT:-240}"
GRACE="${E2E_GRACE:-20}"
if [[ -n "${E2E_HOSTED:-}" ]]; then
  APP_SLUG="${E2E_APP_SLUG:-merge-warden-bostonaholic}"
else
  APP_SLUG="${E2E_APP_SLUG:-merge-warden-dev-bostonaholic}"
fi
CHECK_NAME="merge-warden"

TS=$(date +%s)
PR_NUMBERS=()
BRANCHES=()
SERVER_PID=""
SERVER_LOG=""

log() { printf '%s\n' "$*"; }
fail() {
  log "FAIL: $*"
  for n in "${PR_NUMBERS[@]:-}"; do
    [[ -n "$n" ]] && log "inspect: https://github.com/$REPO/pull/$n (will be closed)"
  done
  if [[ -n "$SERVER_LOG" ]]; then
    log "-- app server log (tail) --"
    tail -20 "$SERVER_LOG" || true
  fi
  exit 1
}

cleanup() {
  for n in "${PR_NUMBERS[@]:-}"; do
    [[ -n "$n" ]] && gh pr close "$n" --repo "$REPO" --delete-branch >/dev/null 2>&1 || true
  done
  for b in "${BRANCHES[@]:-}"; do
    [[ -n "$b" ]] && gh api -X DELETE "repos/$REPO/git/refs/heads/$b" >/dev/null 2>&1 || true
  done
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

start_server() {
  [[ -f .env ]] || fail ".env is missing — the app has never been registered (see README Setup)"
  grep -q '^ANTHROPIC_API_KEY=.' .env || fail ".env has no ANTHROPIC_API_KEY — every grade would fail"
  log "  building and starting the app server"
  npm run build >/dev/null
  SERVER_LOG=$(mktemp -t merge-warden-e2e-server)
  node_modules/.bin/probot run ./lib/index.js >"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  local deadline=$(( $(date +%s) + 30 ))
  while (( $(date +%s) < deadline )); do
    if grep -q 'Connected to https://smee.io' "$SERVER_LOG"; then
      log "  server up (pid $SERVER_PID), webhook proxy connected"
      return 0
    fi
    kill -0 "$SERVER_PID" 2>/dev/null || fail "app server exited during startup"
    sleep 1
  done
  fail "app server did not connect to the webhook proxy within 30s"
}

# put_file <branch> <path> <content> <message>
put_file() {
  gh api -X PUT "repos/$REPO/contents/$2" \
    -f message="$4" -f content="$(printf '%s' "$3" | base64)" -f branch="$1" >/dev/null
}

# open_pr <branch> <base> <draft:true|false> <path> <content> [commit message]
# -> sets OPENED_PR. Not $(...)-substituted: a subshell would lose the
# PR_NUMBERS/BRANCHES bookkeeping that cleanup depends on.
OPENED_PR=""
open_pr() {
  local branch="$1" base="$2" draft="$3" path="$4" content="$5" message="${6:-docs: e2e $1}" base_sha number
  base_sha=$(gh api "repos/$REPO/git/ref/heads/$base" --jq .object.sha)
  gh api -X POST "repos/$REPO/git/refs" -f ref="refs/heads/$branch" -f sha="$base_sha" >/dev/null
  BRANCHES+=("$branch")
  put_file "$branch" "$path" "$content" "$message"
  number=$(gh api -X POST "repos/$REPO/pulls" \
    -f title="e2e: $branch" -f head="$branch" -f base="$base" \
    -f body="e2e run $TS." -F draft="$draft" --jq .number)
  PR_NUMBERS+=("$number")
  OPENED_PR="$number"
  log "  PR: https://github.com/$REPO/pull/$number"
}

head_sha() { gh api "repos/$REPO/pulls/$1" --jq .head.sha; }

# The newest completed merge-warden run on the sha from this app, as
# "conclusion|title", or empty. Filtered by app slug: any app can create a
# run with this name.
own_check() {
  gh api "repos/$REPO/commits/$1/check-runs?check_name=$CHECK_NAME&filter=all" \
    --jq "[.check_runs[] | select(.app.slug == \"$APP_SLUG\")] | sort_by(.id) | last
          | select(. != null and .status == \"completed\") | .conclusion + \"|\" + .output.title" \
    2>/dev/null || true
}

# wait_for_check <sha> <conclusion> [title-substring]
wait_for_check() {
  local sha="$1" want="$2" title="${3:-}" deadline got
  deadline=$(( $(date +%s) + POLL_TIMEOUT ))
  while (( $(date +%s) < deadline )); do
    got=$(own_check "$sha")
    if [[ "$got" == "$want|"* && "$got" == *"$title"* ]]; then
      log "  check: ${got/|/ \"}\""
      return 0
    fi
    sleep 5
  done
  fail "timed out after ${POLL_TIMEOUT}s waiting for check [$want|*$title*] on $sha; last seen [${got:-none}]"
}

# The app's sticky grade comment on the PR, found by its hidden marker and
# the app's login. Posted after the verdict, so poll for it.
grade_comment() {
  gh api "repos/$REPO/issues/$1/comments" \
    --jq "[.[] | select(.user.login == \"${APP_SLUG}[bot]\" and (.body | contains(\"<!-- merge-warden: grade -->\")))] | .[0].body // empty" \
    2>/dev/null || true
}

# wait_for_comment <pr> <substring>...: every substring is in the comment.
wait_for_comment() {
  local number="$1" deadline body s missing
  shift
  deadline=$(( $(date +%s) + POLL_TIMEOUT ))
  while (( $(date +%s) < deadline )); do
    body=$(grade_comment "$number")
    missing=""
    for s in "$@"; do
      [[ "$body" == *"$s"* ]] || { missing="$s"; break; }
    done
    if [[ -n "$body" && -z "$missing" ]]; then
      log "  grade comment has: $*"
      return 0
    fi
    sleep 5
  done
  fail "timed out waiting for the grade comment on PR #$number to contain [${missing:-$*}]"
}

# The short sha the comment names as graded.
short() { printf '%s' "${1:0:7}"; }

wait_merged() {
  local number="$1" deadline merged
  deadline=$(( $(date +%s) + POLL_TIMEOUT ))
  while (( $(date +%s) < deadline )); do
    merged=$(gh api "repos/$REPO/pulls/$number" --jq .merged)
    if [[ "$merged" == "true" ]]; then
      log "  PR #$number merged"
      return 0
    fi
    sleep 5
  done
  fail "timed out after ${POLL_TIMEOUT}s waiting for PR #$number to merge"
}

bot_approvals() {
  gh api "repos/$REPO/pulls/$1/reviews" \
    --jq "[.[] | select(.user.login == \"${APP_SLUG}[bot]\" and .state == \"APPROVED\")] | length"
}

assert_approved() {
  [[ "$(bot_approvals "$1")" != "0" ]] || fail "PR #$1 merged without an approval from ${APP_SLUG}[bot]"
  log "  PR #$1 approved by ${APP_SLUG}[bot]"
}

# After the grace period: still open, and no approval from the app.
assert_untouched() {
  local number="$1" state
  sleep "$GRACE"
  state=$(gh api "repos/$REPO/pulls/$number" --jq .state)
  [[ "$state" == "open" ]] || fail "PR #$number is $state; expected open"
  [[ "$(bot_approvals "$number")" == "0" ]] || fail "PR #$number was approved by ${APP_SLUG}[bot]"
  log "  PR #$number untouched (open, not approved)"
}

# The newest run of the sandbox `check` job on the sha. A label event
# starts another run on the same commit; only the newest one counts.
wait_for_ci_conclusion() {
  local sha="$1" want="$2" deadline got
  deadline=$(( $(date +%s) + POLL_TIMEOUT ))
  while (( $(date +%s) < deadline )); do
    got=$(gh api "repos/$REPO/commits/$sha/check-runs?check_name=check" \
      --jq '[.check_runs[]] | sort_by(.id) | last | select(. != null and .status == "completed") | .conclusion' \
      2>/dev/null || true)
    if [[ "$got" == "$want" ]]; then
      log "  CI on $sha concluded: $got"
      return 0
    fi
    sleep 5
  done
  fail "timed out waiting for CI $want on $sha; last seen [${got:-none}]"
}

add_label() {
  gh api -X POST "repos/$REPO/issues/$1/labels" -f "labels[]=$2" >/dev/null
}

remove_label() {
  gh api -X DELETE "repos/$REPO/issues/$1/labels/$2" >/dev/null
}

log "== preflight"
# The run approves and merges PRs into the target's main: refuse any repo
# that is not a sandbox.
[[ "$REPO" == *-sandbox ]] || fail "E2E_REPO=$REPO is not a sandbox repo (name must end in -sandbox)"
gh api "repos/$REPO" --jq .full_name >/dev/null || fail "cannot reach $REPO with gh"
for f in .github/workflows/e2e-ci.yml .github/merge-warden.yml; do
  gh api "repos/$REPO/contents/$f" --jq .name >/dev/null 2>&1 \
    || fail "$REPO is missing $f — run the sandbox setup in the e2e skill"
done
gh api "repos/$REPO/contents/.github/workflows/e2e-ci.yml" --jq .content | base64 -d | grep -q e2e-fail-ci \
  || fail "$REPO's e2e-ci workflow predates the [e2e-fail-ci] commit-message trigger — update it from the e2e skill"
gh api "repos/$REPO/contents/.github/workflows/e2e-ci.yml" --jq .content | base64 -d | grep -q unlabeled \
  || fail "$REPO's e2e-ci workflow predates the e2e-fail-ci label trigger — update it from the e2e skill"
for label in one-way-door no-auto-merge e2e-fail-ci; do
  gh api -X POST "repos/$REPO/labels" -f name="$label" -f color=cccccc >/dev/null 2>&1 || true
done
if [[ -n "${E2E_HOSTED:-}" ]]; then
  HOSTED_URL="${E2E_TARGET_URL:-https://merge-warden.bostonaholic.dev}"
  # GET on the exact webhook path returns 404 from a healthy app: the
  # function cold-started, meaning the env credentials parsed at module load.
  code=$(curl -s -o /dev/null -w '%{http_code}' "$HOSTED_URL/api/github/webhooks")
  [[ "$code" == "404" ]] \
    || fail "hosted app at $HOSTED_URL is not healthy (GET on the webhook path returned ${code:-nothing}, expected 404)"
  log "  hosted mode: $HOSTED_URL (app $APP_SLUG)"
elif curl -s -o /dev/null http://localhost:3000; then
  log "  reusing the already-running app server on :3000 (may not reflect current source)"
else
  start_server
fi

log "== 1: low-risk change -> success, approved, merged once CI is green"
open_pr "e2e-low-$TS" main false "notes/e2e-$TS-1.md" "Notes from e2e run $TS."
PR1="$OPENED_PR"
HEAD1=$(head_sha "$PR1")
wait_for_check "$HEAD1" success "Eligible for auto-merge"
wait_for_comment "$PR1" "✅ merge-warden: eligible for auto-merge" "🔄 Reversible" "Graded commit $(short "$HEAD1")"
wait_merged "$PR1"
assert_approved "$PR1"

log "== 2: schema migration, judged one-way by the model -> neutral, never approved or merged"
open_pr "e2e-migration-$TS" main false "db/migrations/e2e_$TS.sql" "ALTER TABLE e2e ADD COLUMN note text;"
PR2="$OPENED_PR"
wait_for_check "$(head_sha "$PR2")" neutral "one-way door"
wait_for_comment "$PR2" "⚠️ merge-warden: needs a person" "⛔ Irreversible"
assert_untouched "$PR2"

log "== 3: one-way-door label on a low-risk change -> neutral, never merged"
open_pr "e2e-label-oneway-$TS" main true "notes/e2e-$TS-3.md" "Notes from e2e run $TS."
PR3="$OPENED_PR"
add_label "$PR3" one-way-door
gh pr ready "$PR3" --repo "$REPO" >/dev/null
log "  draft -> labeled one-way-door -> ready"
wait_for_check "$(head_sha "$PR3")" neutral "label: one-way-door"
assert_untouched "$PR3"

log "== 4: no-auto-merge label -> graded success, never approved or merged"
open_pr "e2e-label-nomerge-$TS" main true "notes/e2e-$TS-4.md" "Notes from e2e run $TS."
PR4="$OPENED_PR"
add_label "$PR4" no-auto-merge
gh pr ready "$PR4" --repo "$REPO" >/dev/null
log "  draft -> labeled no-auto-merge -> ready"
HEAD4=$(head_sha "$PR4")
wait_for_check "$HEAD4" success "Eligible for auto-merge"
wait_for_ci_conclusion "$HEAD4" success
assert_untouched "$PR4"

log "== 5: red CI blocks a success verdict, then merges after a fixing commit"
# The sandbox CI fails when the head commit's message contains
# [e2e-fail-ci]. The model sees only the diff, so it grades the same plain
# notes file as step 1; a fail-marker file in the diff lowered its
# confidence. Opened as draft so nothing is approved before CI is red.
open_pr "e2e-redci-$TS" main true "notes/e2e-$TS-5.md" "Notes from e2e run $TS." "docs: e2e notes [e2e-fail-ci]"
PR5="$OPENED_PR"
HEAD5=$(head_sha "$PR5")
wait_for_check "$HEAD5" success "Eligible for auto-merge"
wait_for_ci_conclusion "$HEAD5" failure
gh pr ready "$PR5" --repo "$REPO" >/dev/null
log "  draft (CI red) -> ready"
assert_untouched "$PR5"
put_file "e2e-redci-$TS" "notes/e2e-$TS-5b.md" "More notes from e2e run $TS." "docs: more e2e notes"
# The branch ref moves at once; the PR head can lag behind it.
HEAD5B=$(gh api "repos/$REPO/git/ref/heads/e2e-redci-$TS" --jq .object.sha)
log "  pushed a fixing commit $HEAD5B"
wait_for_check "$HEAD5B" success "Eligible for auto-merge"
wait_for_comment "$PR5" "Graded commit $(short "$HEAD5B")"
wait_merged "$PR5"
assert_approved "$PR5"

log "== 6: PR off the default branch -> out of scope, no check run"
BASE6="e2e-base-$TS"
gh api -X POST "repos/$REPO/git/refs" -f ref="refs/heads/$BASE6" \
  -f sha="$(gh api "repos/$REPO/git/ref/heads/main" --jq .object.sha)" >/dev/null
BRANCHES+=("$BASE6")
open_pr "e2e-offbase-$TS" "$BASE6" false "notes/e2e-$TS-6.md" "Notes from e2e run $TS."
PR6="$OPENED_PR"
assert_untouched "$PR6"
runs=$(gh api "repos/$REPO/commits/$(head_sha "$PR6")/check-runs?check_name=$CHECK_NAME&filter=all" \
  --jq "[.check_runs[] | select(.app.slug == \"$APP_SLUG\")] | length")
[[ "$runs" == "0" ]] || fail "PR #$PR6 targets $BASE6 but got $runs $CHECK_NAME check run(s)"
log "  PR #$PR6 has no $CHECK_NAME check"

log "== 7: a superseded red CI run does not block the merge"
# The e2e-fail-ci label fails the sandbox CI. Labeling and unlabeling one
# commit leaves a failed run and a newer passing run, each in its own check
# suite; checksRollup must read only the newest.
open_pr "e2e-relabel-$TS" main true "notes/e2e-$TS-7.md" "Notes from e2e run $TS."
PR7="$OPENED_PR"
HEAD7=$(head_sha "$PR7")
wait_for_check "$HEAD7" success "Eligible for auto-merge"
wait_for_ci_conclusion "$HEAD7" success
add_label "$PR7" e2e-fail-ci
wait_for_ci_conclusion "$HEAD7" failure
gh pr ready "$PR7" --repo "$REPO" >/dev/null
log "  draft -> labeled e2e-fail-ci (CI red) -> ready"
assert_untouched "$PR7"
remove_label "$PR7" e2e-fail-ci
log "  unlabeled e2e-fail-ci; same commit $HEAD7"
wait_for_ci_conclusion "$HEAD7" success
wait_merged "$PR7"
assert_approved "$PR7"

log "E2E PASS ($REPO PRs #$PR1 #$PR2 #$PR3 #$PR4 #$PR5 #$PR6 #$PR7)"
