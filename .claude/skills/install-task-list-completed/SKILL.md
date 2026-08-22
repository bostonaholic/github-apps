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
- **The REST API cannot manage installation repo selection.** Every
  `/user/installations` endpoint returns 403 with `gh`'s token (they require
  a GitHub-App user token). Do not retry via API — installation happens in
  the browser (Claude-in-Chrome).
- **No hosted deployment.** The app runs locally (`npm start` + smee.io
  proxy). Statuses only report while that process is up; a *required* check
  with the app down blocks merges on the repo.

## Step 1 — validate the repo

```bash
gh repo view <owner>/<repo> --json owner,isArchived,isFork,defaultBranchRef
```

Owner must be `bostonaholic`; refuse archived repos; warn on forks (PRs
usually target upstream, where this installation does not apply). Keep the
default branch name for Step 3.

## Step 2 — install (browser)

Manage the installation at <https://github.com/settings/installations> →
**Configure** next to `task-list-completed-bostonaholic` (direct fast path:
<https://github.com/settings/installations/155556892>; if that 404s the app
was reinstalled under a new ID — go via the list page. If the app is missing
from the list entirely, it was uninstalled: stop and follow the Setup
section of `task-list-completed/README.md`).

On the installation page, under "Repository access" (keep **Only select
repositories** selected — do not flip to "All repositories"):

1. If the repo already appears under "Selected N repositories", it is
   installed — skip to Step 3.
2. Click **Select repositories**, then **wait ~1 s before typing**: the
   search input focuses asynchronously, and early keystrokes leak to
   GitHub's global hotkeys and open the command palette (press Escape and
   reopen the picker to recover).
3. Type the repo name, wait ~1 s for the async filter, then click the exact
   `bostonaholic/<repo>` entry. Beware substring collisions (`dev` also
   matches `dev-conveyor-demo`; `dotfiles` also matches `block-dotfiles`,
   `shopify-dotfiles`) — locate the entry by its exact accessible name
   (element ref), not by coordinates: selections re-render the page and
   shift scroll position, so saved coordinates go stale.
4. Confirm the "Selected N repositories" count went up by one and the repo
   is listed, then click **Save**.
5. Reload the page and confirm the repo is still listed (persisted
   server-side), then close the tab.

## Step 3 — configure

**Config file — usually none.** The app works with zero config. Only add
`.github/task-list.yml` in the target repo when the user wants non-default
behavior (`enabled: false` disables the app repo-wide). Do not commit a
config file that just restates defaults.

**Required status check.** The app reports a *commit status* (not a check
run) with context `task-list-completed`. Making it required is what actually
blocks merges — but given the no-hosted-deployment constraint above, confirm
with the user before requiring it unless they already asked. Then, on the
default branch:

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

- Installation: only the settings page can confirm it (API is 403) — the
  post-Save reload in Step 2 is the check.
- Required check: `gh api repos/<owner>/<repo>/branches/<branch>/protection/required_status_checks`
  lists `task-list-completed`.
- Live behavior (optional, with the user's OK — it opens and closes a real
  PR in the target repo): `cd task-list-completed && E2E_REPO=<owner>/<repo> npm run test:e2e`
  — see the `e2e-task-list-completed` skill for preconditions and failure
  interpretation.

## Report

End by telling the user: what was installed/configured, and — if the check
was made required — the reminder that statuses only report while the local
app process is running.
