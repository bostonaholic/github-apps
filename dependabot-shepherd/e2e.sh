#!/usr/bin/env bash
# End-to-end verification for the dependabot-shepherd GitHub App.
#
# Simulates Dependabot PRs in the sandbox repo (there is no API to make
# Dependabot open one on demand) and asserts the app's behavior: an allowed
# patch merges once CI is green, a major is left alone, the ignore label is
# respected, red CI blocks until fixed, and a push to main draws a
# "@dependabot rebase" comment on a stale PR.
#
# Requires: gh (authenticated with push access to the sandbox), a registered
# app (.env present), the app installed on the sandbox repo, and the sandbox
# prepared with the e2e-ci workflow (see the e2e skill for one-time setup).
#
# The app server is started by this script with E2E_ALLOW_AUTHOR set to the
# gh user, so the app accepts PRs this script authors as if they were
# Dependabot's. A server already listening on :3000 is reused — it must have
# been started with E2E_ALLOW_AUTHOR itself or every scenario will time out.
set -euo pipefail
cd "$(dirname "$0")"

REPO="${E2E_REPO:-bostonaholic/shepherd-sandbox}"
POLL_TIMEOUT="${E2E_POLL_TIMEOUT:-240}"
GRACE="${E2E_GRACE:-20}"

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
  log "  building and starting the app server (E2E_ALLOW_AUTHOR=$GH_USER)"
  npm run build >/dev/null
  SERVER_LOG=$(mktemp -t shepherd-e2e-server)
  E2E_ALLOW_AUTHOR="$GH_USER" node_modules/.bin/probot run ./lib/index.js >"$SERVER_LOG" 2>&1 &
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

# open_pr <branch> <title> <draft:true|false> [marker] -> sets OPENED_PR.
# Deliberately NOT $(...)-substituted: that would run it in a subshell and
# lose the PR_NUMBERS/BRANCHES bookkeeping that cleanup depends on.
OPENED_PR=""
open_pr() {
  local branch="$1" title="$2" draft="$3" marker="${4:-}" base_sha number
  base_sha=$(gh api "repos/$REPO/git/ref/heads/main" --jq .object.sha)
  gh api -X POST "repos/$REPO/git/refs" -f ref="refs/heads/$branch" -f sha="$base_sha" >/dev/null
  BRANCHES+=("$branch")
  gh api -X PUT "repos/$REPO/contents/e2e-$TS-${#BRANCHES[@]}.txt" \
    -f message="build(deps): $title" \
    -f content="$(printf 'e2e' | base64)" \
    -f branch="$branch" >/dev/null
  if [[ -n "$marker" ]]; then
    gh api -X PUT "repos/$REPO/contents/$marker" \
      -f message="test: add failure marker" \
      -f content="$(printf 'fail' | base64)" \
      -f branch="$branch" >/dev/null
  fi
  number=$(gh api -X POST "repos/$REPO/pulls" \
    -f title="$title" -f head="$branch" -f base=main \
    -f body="e2e run $TS." -F draft="$draft" --jq .number)
  PR_NUMBERS+=("$number")
  OPENED_PR="$number"
}

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

assert_untouched() {
  local number="$1" state reviews
  sleep "$GRACE"
  state=$(gh api "repos/$REPO/pulls/$number" --jq .state)
  [[ "$state" == "open" ]] || fail "PR #$number is $state; expected open"
  reviews=$(gh api "repos/$REPO/pulls/$number/reviews" --jq length)
  [[ "$reviews" == "0" ]] || fail "PR #$number has $reviews review(s); expected none"
  log "  PR #$number untouched (open, no reviews)"
}

wait_for_ci_conclusion() {
  local sha="$1" want="$2" deadline got
  deadline=$(( $(date +%s) + POLL_TIMEOUT ))
  while (( $(date +%s) < deadline )); do
    got=$(gh api "repos/$REPO/commits/$sha/check-runs" \
      --jq '[.check_runs[] | select(.status == "completed")][0].conclusion // empty' 2>/dev/null || true)
    if [[ "$got" == "$want" ]]; then
      log "  CI on $sha concluded: $got"
      return 0
    fi
    sleep 5
  done
  fail "timed out waiting for CI $want on $sha; last seen [${got:-none}]"
}

wait_for_rebase_comment() {
  local number="$1" deadline found
  deadline=$(( $(date +%s) + POLL_TIMEOUT ))
  while (( $(date +%s) < deadline )); do
    found=$(gh api "repos/$REPO/issues/$number/comments" \
      --jq '[.[] | select(.body | contains("@dependabot rebase"))] | length')
    if [[ "$found" != "0" ]]; then
      log "  PR #$number has a rebase request comment"
      return 0
    fi
    sleep 5
  done
  fail "timed out waiting for a @dependabot rebase comment on PR #$number"
}

log "== preflight"
GH_USER=$(gh api user --jq .login) || fail "gh is not authenticated"
gh api "repos/$REPO" --jq .full_name >/dev/null || fail "cannot reach $REPO with gh"
gh api "repos/$REPO/contents/.github/workflows/e2e-ci.yml" --jq .name >/dev/null 2>&1 \
  || fail "$REPO is missing .github/workflows/e2e-ci.yml — run the sandbox setup in the e2e skill"
gh api -X POST "repos/$REPO/labels" -f name="shepherd: ignore" -f color=cccccc >/dev/null 2>&1 || true
if curl -s -o /dev/null http://localhost:3000; then
  log "  reusing the already-running app server on :3000 (must have E2E_ALLOW_AUTHOR=$GH_USER)"
else
  start_server
fi

log "== 1: allowed patch merges once CI is green"
open_pr "dependabot/npm_and_yarn/e2e-lodash-$TS" \
  "Bump lodash from 4.17.20 to 4.17.21" false
PR1="$OPENED_PR"
log "  PR: https://github.com/$REPO/pull/$PR1"
wait_merged "$PR1"

log "== 2: major is left alone"
open_pr "dependabot/npm_and_yarn/e2e-react-$TS" \
  "Bump react from 18.2.0 to 19.0.0" false
PR2="$OPENED_PR"
log "  PR: https://github.com/$REPO/pull/$PR2"
assert_untouched "$PR2"

log "== 3: ignore label is respected"
open_pr "dependabot/npm_and_yarn/e2e-vitest-$TS" \
  "Bump vitest from 3.1.0 to 3.1.1" true
PR3="$OPENED_PR"
gh api -X POST "repos/$REPO/issues/$PR3/labels" -f "labels[]=shepherd: ignore" >/dev/null
gh pr ready "$PR3" --repo "$REPO" >/dev/null
log "  PR: https://github.com/$REPO/pull/$PR3 (draft -> labeled -> ready)"
assert_untouched "$PR3"

log "== 4: red CI blocks, then merges after the fix"
BRANCH4="dependabot/npm_and_yarn/e2e-esbuild-$TS"
open_pr "$BRANCH4" "Bump esbuild from 0.20.0 to 0.20.1" false "e2e-fail-marker"
PR4="$OPENED_PR"
HEAD4=$(gh api "repos/$REPO/pulls/$PR4" --jq .head.sha)
log "  PR: https://github.com/$REPO/pull/$PR4 (head $HEAD4)"
wait_for_ci_conclusion "$HEAD4" failure
sleep "$GRACE"
[[ "$(gh api "repos/$REPO/pulls/$PR4" --jq .merged)" == "false" ]] \
  || fail "PR #$PR4 merged over red CI"
log "  PR #$PR4 blocked while red"
MARKER_SHA=$(gh api "repos/$REPO/contents/e2e-fail-marker?ref=$BRANCH4" --jq .sha)
gh api -X DELETE "repos/$REPO/contents/e2e-fail-marker" \
  -f message="test: remove failure marker" -f sha="$MARKER_SHA" -f branch="$BRANCH4" >/dev/null
wait_merged "$PR4"

log "== 5: push to main draws a rebase request on the stale major PR"
gh api -X PUT "repos/$REPO/contents/e2e-main-$TS.txt" \
  -f message="test: move main forward" \
  -f content="$(printf 'e2e' | base64)" >/dev/null
wait_for_rebase_comment "$PR2"

log "E2E PASS ($REPO PRs #$PR1 #$PR2 #$PR3 #$PR4)"
