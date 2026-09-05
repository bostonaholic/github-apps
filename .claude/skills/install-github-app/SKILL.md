---
name: install-github-app
description: Install one of this repo's GitHub Apps on a repo and configure it. Takes the app and the target repo as arguments. Use when asked to "install <app> on <repo>", "set up <app> for <repo>".
argument-hint: "[app] [owner/repo | repo]"
---

# Install & configure a GitHub App from this repo

Installs one of this monorepo's GitHub Apps on one repo and wires up its
configuration. Two arguments:

- **app** — a directory under `apps/` in this repo (e.g.
  `dependabot-shepherd`, `task-list-completed`). It must have a `.env` file
  and a matching `apps/<app>.md` next to this SKILL.md; the registered
  GitHub slug is `<app>-bostonaholic`. Unknown app → stop and tell the
  user.
- **repo** — the target, `owner/repo` or a bare name (bare names mean
  `bostonaholic/<name>`).

**Read `apps/<app>.md`, the file next to this SKILL.md, before
proceeding** — it holds every app-specific step referenced below
(validation extras, configuration, verification).

## Hard constraints — read first

- **The apps are private**: installable only on repos owned by
  `bostonaholic`. If the argument names another owner, stop and tell the
  user.
- **Installation repo selection needs two credentials** (both in
  `apps/<app>/.env`; never echo them). Reads authenticate as the app — a
  JWT from `APP_ID` + `PRIVATE_KEY` (we own the apps, so no user token or
  device flow). Writes
  (`PUT|DELETE /user/installations/{id}/repositories/{repo_id}`) accept
  only a classic PAT with `repo` scope (`GITHUB_PAT` — user-level, the
  same PAT works for every app and can be copied between `.env` files).
  `gh`'s OAuth token gets 403 on the write endpoints — never retry with it.
- **Hosted on Vercel** at `https://<app>.bostonaholic.dev` — no local
  server involved; installing is all it takes for the app to start acting
  on the repo.

## Step 1 — validate the repo

```bash
gh repo view <owner>/<repo> --json owner,isArchived,isFork,defaultBranchRef
```

Owner must be `bostonaholic`; refuse archived repos; warn on forks. Then
run the checks in the app file's **Validate** section — it may add caveats
that need the user's OK before installing.

## Step 2 — install (API)

`scripts/installation-repos.mjs` handles the whole exchange (run from the
repo root):

```bash
node --env-file=apps/<app>/.env scripts/installation-repos.mjs                 # list: id, then repos
node --env-file=apps/<app>/.env scripts/installation-repos.mjs --add <owner>/<repo>
```

1. List. `NOT INSTALLED` means the app was uninstalled from the account:
   stop and follow the Setup section of `apps/<app>/README.md`. (The app
   file records the installation id known at the time of writing; the list
   always re-resolves it.)
2. Skip to Step 3 if the repo is already listed.
3. `--add` the repo — it expects HTTP 204 and re-lists to confirm.
   (`DELETE` on the same URL removes a repo; a 422 there means the removal
   would empty the installation.)

**If `GITHUB_PAT` is missing or revoked** (non-expiring, so rare): it is a
classic PAT with `repo` scope the user mints at
<https://github.com/settings/tokens/new> and pastes into `.env` themselves.
It is user-level, not app-specific — a working copy in another app's
`.env` (same variable name) can be copied over.

**Browser fallback** (only if the API path is unavailable): manage at
<https://github.com/settings/installations> → **Configure** next to
`<app>-bostonaholic`. Keep **Only select repositories** — do not flip to
"All repositories". In the repo picker, wait ~1 s before typing (early
keystrokes leak to GitHub's global hotkeys) and pick the entry by its
exact accessible name — substring matches collide (`dev` also matches
`dev-conveyor-demo`). Save, then reload the page to confirm persistence.

## Step 3 — configure

Follow the app file's **Configure** section. Shared rule: the apps work
with zero config — only add a config file in the target repo when the user
wants non-default behavior, and never commit one that just restates
defaults.

## Verify

- Installation: the Step 2 list shows the repo.
- Then the app file's **Verify** section.

## Report

End by telling the user what was installed/configured, plus any Step 1
warnings.

## Adding a new app

Create `apps/<new-app>.md` next to this SKILL.md, alongside the existing
ones — not under the repo's top-level `apps/`. Record the registered slug,
hosted URL, and current installation id, then a **Validate** /
**Configure** / **Verify** section each. No changes to this file are
needed.
