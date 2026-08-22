---
name: install-task-list-completed
description: Install the task-list-completed GitHub App on a repo and configure it (required status check, optional config file). Takes the target repo as its argument. Use when asked to "install task-list-completed on <repo>", "add the task list app to <repo>", or "set up task-list-completed for <repo>".
argument-hint: "[owner/repo | repo]"
---

# Install & configure: task-list-completed

Installs the `task-list-completed-bostonaholic` GitHub App on one repo and
wires up its configuration. The argument is the target repo — accept
`owner/repo` or a bare name (bare names mean `bostonaholic/<name>`).

## Hard constraints — read first

- **The app is private**: it can only be installed on repos owned by
  `bostonaholic`. If the argument names another owner, stop and tell the user.
- **Installation repo selection needs two tokens** (both non-expiring, in
  `task-list-completed/.env`; never echo them). GitHub gates the
  `/user/installations` endpoints by token type: reads
  (`GET /user/installations*`) accept only a GitHub-App user token
  (`GITHUB_APP_USER_TOKEN`), writes
  (`PUT|DELETE /user/installations/{id}/repositories/{repo_id}`) accept only
  a classic PAT with `repo` scope (`GITHUB_PAT`). `gh`'s OAuth token gets
  403 on all of them — never retry with it.
- **Hosted on Vercel** at <https://task-list-completed.bostonaholic.dev> —
  statuses report continuously, so a *required* check is safe to add.

## Step 1 — validate the repo

```bash
gh repo view <owner>/<repo> --json owner,isArchived,isFork,defaultBranchRef
```

Owner must be `bostonaholic`; refuse archived repos; warn on forks (PRs
usually target upstream, where this installation does not apply). Keep the
default branch name for Step 3.

## Step 2 — install (API)

Load the tokens (run from the repo root):

```bash
ENV=task-list-completed/.env
APP_TOKEN=$(grep '^GITHUB_APP_USER_TOKEN=' $ENV | cut -d= -f2)  # reads
PAT=$(grep '^GITHUB_PAT=' $ENV | cut -d= -f2)                   # writes
```

1. Resolve the installation id (known id `155556892`; re-resolve if calls
   404 — a reinstall changes it):

   ```bash
   curl -s -H "Authorization: Bearer $APP_TOKEN" https://api.github.com/user/installations \
     | jq '.installations[] | select(.app_slug == "task-list-completed-bostonaholic") | .id'
   ```

   Empty output means the app was uninstalled: stop and follow the Setup
   section of `task-list-completed/README.md`.

2. Skip to Step 3 if the repo is already selected:

   ```bash
   curl -s -H "Authorization: Bearer $APP_TOKEN" \
     "https://api.github.com/user/installations/<id>/repositories?per_page=100" \
     | jq '[.repositories[].full_name] | contains(["<owner>/<repo>"])'
   ```

3. Add the repo (expect HTTP 204; `DELETE` on the same URL removes one —
   a 422 there means the removal would empty the installation):

   ```bash
   REPO_ID=$(gh api repos/<owner>/<repo> --jq .id)
   curl -s -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $PAT" \
     "https://api.github.com/user/installations/<id>/repositories/$REPO_ID"
   ```

4. Re-run the check from item 2 and confirm it now prints `true`.

**If a token is missing or revoked** (both are non-expiring, so this is
rare): `GITHUB_PAT` is a classic PAT with `repo` scope the user mints at
<https://github.com/settings/tokens/new> and pastes into `.env` themselves.
`GITHUB_APP_USER_TOKEN` comes from the device flow (enabled on the app
2026-08-22, along with the user-token-expiration opt-out):

```bash
curl -s -X POST https://github.com/login/device/code -H "Accept: application/json" \
  -d "client_id=$(grep '^GITHUB_CLIENT_ID=' $ENV | cut -d= -f2)"
# The user opens github.com/login/device, enters the user_code, and clicks
# Authorize — that click is human-only (the button's clickjacking protection
# defeats automation; don't try). Then exchange, and store access_token:
curl -s -X POST https://github.com/login/oauth/access_token -H "Accept: application/json" \
  -d "client_id=<same>" -d "device_code=<from above>" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code"
```

**Browser fallback** (only if the API path is unavailable): manage at
<https://github.com/settings/installations> → **Configure** next to
`task-list-completed-bostonaholic`. Keep **Only select repositories** — do
not flip to "All repositories". In the repo picker, wait ~1 s before typing
(early keystrokes leak to GitHub's global hotkeys) and pick the entry by its
exact accessible name — substring matches collide (`dev` also matches
`dev-conveyor-demo`). Save, then reload the page to confirm persistence.

## Step 3 — configure

**Config file — usually none.** The app works with zero config. Only add
`.github/task-list.yml` in the target repo when the user wants non-default
behavior (`enabled: false` disables the app repo-wide). Do not commit a
config file that just restates defaults.

**Required status check.** The app reports a *commit status* (not a check
run) with context `task-list-completed`. Making it required is what actually
blocks merges. On the default branch:

- Existing classic protection — append without clobbering:

  ```bash
  gh api -X POST repos/<owner>/<repo>/branches/<branch>/protection/required_status_checks/contexts \
    -f "contexts[]=task-list-completed"
  ```

- No protection yet (`gh api .../protection` returns 404) — create minimal:

  ```bash
  gh api -X PUT repos/<owner>/<repo>/branches/<branch>/protection \
    --input - <<'EOF'
  {
    "required_status_checks": { "strict": false, "contexts": ["task-list-completed"] },
    "enforce_admins": false,
    "required_pull_request_reviews": null,
    "restrictions": null
  }
  EOF
  ```

- If the repo governs merges with **rulesets** instead
  (`gh api repos/<owner>/<repo>/rulesets` non-empty), add the context to the
  existing ruleset's "required status checks" rule rather than layering
  classic protection on top.

## Verify

- Installation: the Step 2 read check
  (`GET /user/installations/<id>/repositories`) lists the repo.
- Required check: `gh api repos/<owner>/<repo>/branches/<branch>/protection/required_status_checks`
  lists `task-list-completed`.
- Live behavior (optional, with the user's OK — it opens and closes a real
  PR in the target repo): `cd task-list-completed && E2E_REPO=<owner>/<repo> npm run test:e2e`
  — see the `e2e-task-list-completed` skill for preconditions and failure
  interpretation.

## Report

End by telling the user what was installed/configured.
