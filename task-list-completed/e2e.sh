#!/usr/bin/env bash
# End-to-end verification for the task-list-completed GitHub App.
#
# Opens a real PR in the sandbox repo and drives it through the full task
# list lifecycle, asserting the commit status and sticky comment after each
# mutation. Requires: gh (authenticated with access to the sandbox repo),
# a registered app (.env present), and the app installed on the sandbox repo.
#
# The app server does not need to be running: the script builds and starts
# it, waits for webhook delivery to connect, and stops it on exit. A server
# already listening on :3000 is reused instead and left running (it may be
# running stale code).
#
# E2E_HOSTED=1 skips the server lifecycle entirely and asserts against the
# deployed app (E2E_TARGET_URL overrides the URL). Note this tests the
# deployed code, not the working tree.
#
# The PR and branch are cleaned up on exit (pass or fail); the closed PR
# remains in the sandbox for inspection.
set -euo pipefail
cd "$(dirname "$0")"

REPO="${E2E_REPO:-bostonaholic/task-list-sandbox}"
POLL_TIMEOUT="${E2E_POLL_TIMEOUT:-90}"

BRANCH="e2e-$(date +%s)"
PR_NUMBER=""
SERVER_PID=""
SERVER_LOG=""

log() { printf '%s\n' "$*"; }
fail() {
  log "FAIL: $*"
  [[ -n "$PR_NUMBER" ]] && log "inspect: https://github.com/$REPO/pull/$PR_NUMBER (will be closed)"
  if [[ -n "$SERVER_LOG" ]]; then
    log "-- app server log (tail) --"
    tail -20 "$SERVER_LOG" || true
  fi
  exit 1
}

cleanup() {
  if [[ -n "$PR_NUMBER" ]]; then
    gh pr close "$PR_NUMBER" --repo "$REPO" --delete-branch >/dev/null 2>&1 || true
  fi
  # covers a setup failure after the branch exists but before the PR does
  gh api -X DELETE "repos/$REPO/git/refs/heads/$BRANCH" >/dev/null 2>&1 || true
  # only stop a server this script started
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

start_server() {
  [[ -f .env ]] || fail ".env is missing — the app has never been registered (see README Setup)"
  log "  building and starting the app server"
  npm run build >/dev/null
  SERVER_LOG=$(mktemp -t task-list-e2e-server)
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

# Poll until the task-list-completed status on the sha matches the expected
# state and description, or time out.
wait_for_status() {
  local sha="$1" state="$2" description="$3" deadline actual
  deadline=$(( $(date +%s) + POLL_TIMEOUT ))
  while (( $(date +%s) < deadline )); do
    actual=$(gh api "repos/$REPO/commits/$sha/status" \
      --jq '[.statuses[] | select(.context == "task-list-completed")][0] | .state + "|" + .description' \
      2>/dev/null || true)
    if [[ "$actual" == "$state|$description" ]]; then
      log "  status: $state \"$description\""
      return 0
    fi
    sleep 3
  done
  fail "timed out after ${POLL_TIMEOUT}s waiting for [$state|$description]; last seen [${actual:-none}]"
}

sticky_comment() {
  gh api "repos/$REPO/issues/$PR_NUMBER/comments" \
    --jq "[.[] | select(.body | contains(\"<!-- task-list: sticky-comment -->\"))][0]$1"
}

log "== preflight"
gh api "repos/$REPO" --jq .full_name >/dev/null \
  || fail "cannot reach $REPO with gh"
if [[ -n "${E2E_HOSTED:-}" ]]; then
  HOSTED_URL="${E2E_TARGET_URL:-https://task-list-completed.bostonaholic.dev}"
  # GET on the exact webhook path returns 404 from a healthy app: the
  # function cold-started, meaning the env credentials parsed at module load.
  code=$(curl -s -o /dev/null -w '%{http_code}' "$HOSTED_URL/api/github/webhooks")
  [[ "$code" == "404" ]] \
    || fail "hosted app at $HOSTED_URL is not healthy (GET on the webhook path returned ${code:-nothing}, expected 404)"
  log "  hosted mode: $HOSTED_URL"
elif curl -s -o /dev/null http://localhost:3000; then
  log "  reusing the already-running app server on :3000 (may not reflect current source)"
else
  start_server
fi

log "== setup: open PR with 1 unchecked + 1 checked task"
BASE_SHA=$(gh api "repos/$REPO/git/ref/heads/main" --jq .object.sha)
gh api -X POST "repos/$REPO/git/refs" -f ref="refs/heads/$BRANCH" -f sha="$BASE_SHA" >/dev/null
gh api -X PUT "repos/$REPO/contents/$BRANCH.txt" \
  -f message="test: e2e $BRANCH" \
  -f content="$(printf 'e2e' | base64)" \
  -f branch="$BRANCH" >/dev/null
PR_NUMBER=$(gh api -X POST "repos/$REPO/pulls" \
  -f title="e2e: $BRANCH" -f head="$BRANCH" -f base=main \
  -f body=$'e2e run.\n\n## Pre-merge checklist\n\n- [ ] run the database migration\n- [x] update the docs' \
  --jq .number)
HEAD_SHA=$(gh api "repos/$REPO/pulls/$PR_NUMBER" --jq .head.sha)
log "  PR: https://github.com/$REPO/pull/$PR_NUMBER (head $HEAD_SHA)"

log "== 1: unchecked task in the description -> red status + sticky comment"
wait_for_status "$HEAD_SHA" failure "1 of 2 tasks remaining"
sticky_comment .body | grep -qF '[run the database migration]' \
  || fail "sticky comment is missing the linked outstanding item"
STICKY_URL=$(sticky_comment .html_url)
TARGET_URL=$(gh api "repos/$REPO/commits/$HEAD_SHA/status" \
  --jq '[.statuses[] | select(.context == "task-list-completed")][0].target_url')
[[ "$TARGET_URL" == "$STICKY_URL" ]] \
  || fail "status target_url ($TARGET_URL) does not point at the sticky comment ($STICKY_URL)"

log "== 2: comment with an unchecked task -> counted"
COMMENT_ID=$(gh api -X POST "repos/$REPO/issues/$PR_NUMBER/comments" \
  -f body=$'Before merge:\n\n- [ ] get sign-off from security' --jq .id)
wait_for_status "$HEAD_SHA" failure "2 of 3 tasks remaining"

log "== 3: check the description box -> recounted"
gh api -X PATCH "repos/$REPO/pulls/$PR_NUMBER" \
  -f body=$'e2e run.\n\n## Pre-merge checklist\n\n- [x] run the database migration\n- [x] update the docs' >/dev/null
wait_for_status "$HEAD_SHA" failure "1 of 3 tasks remaining"

log "== 4: ignore marker excludes the comment -> green"
gh api -X PATCH "repos/$REPO/issues/comments/$COMMENT_ID" \
  -f body=$'<!-- task-list: ignore -->\nNotes, not gates:\n\n- [ ] get sign-off from security' >/dev/null
wait_for_status "$HEAD_SHA" success "All 2 tasks complete"
sticky_comment .body | grep -qF 'all 2 tasks complete' \
  || fail "sticky comment did not flip to the all-complete body"

log "== 5: review with an unchecked task -> red"
REVIEW_ID=$(gh api -X POST "repos/$REPO/pulls/$PR_NUMBER/reviews" \
  -f event=COMMENT -f body="- [ ] rename the feature file" --jq .id)
wait_for_status "$HEAD_SHA" failure "1 of 3 tasks remaining"
sticky_comment .body | grep -q 'pullrequestreview' \
  || fail "sticky comment does not link back to the review"

log "== 6: check the review box -> green"
gh api -X PUT "repos/$REPO/pulls/$PR_NUMBER/reviews/$REVIEW_ID" \
  -f body="- [x] rename the feature file" >/dev/null
wait_for_status "$HEAD_SHA" success "All 3 tasks complete"

log "E2E PASS ($REPO PR #$PR_NUMBER)"
