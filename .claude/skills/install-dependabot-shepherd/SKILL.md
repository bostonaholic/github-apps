---
name: install-dependabot-shepherd
description: Install the dependabot-shepherd GitHub App on a repo so its Dependabot PRs auto-merge per policy (optional policy config file). Takes the target repo as its argument. Use when asked to "install dependabot-shepherd on <repo>", "add the shepherd to <repo>", or "set up dependabot-shepherd for <repo>".
argument-hint: "[owner/repo | repo]"
---

# Install & configure: dependabot-shepherd

Installs the `dependabot-shepherd-bostonaholic` GitHub App on one repo and
checks the repo is a sensible target. The argument is the target repo —
accept `owner/repo` or a bare name (bare names mean `bostonaholic/<name>`).

## Hard constraints — read first

- **The app is private**: it can only be installed on repos owned by
  `bostonaholic`. If the argument names another owner, stop and tell the user.
- **Installation repo selection needs two credentials** (both in
  `dependabot-shepherd/.env`; never echo them). Reads go through the app's
  own JWT (`APP_ID` + `PRIVATE_KEY` — we own the app, so no user token or
  device flow, unlike the task-list-completed skill). Writes
  (`PUT|DELETE /user/installations/{id}/repositories/{repo_id}`) accept
  only a classic PAT with `repo` scope (`GITHUB_PAT` — user-level, the same
  PAT as task-list-completed's). `gh`'s OAuth token gets 403 on the write
  endpoints — never retry with it.
- **Hosted on Vercel** at <https://dependabot-shepherd.bostonaholic.dev> —
  no local server involved; installing is all it takes for the repo's
  Dependabot PRs to start being shepherded.
- **No-CI repos merge instantly**: on a repo with no workflow files and no
  commit statuses, an allowed update merges immediately after approval.
  Step 1 detects this — surface it and get the user's OK before installing
  on such a repo.

## Step 1 — validate the repo

```bash
gh repo view <owner>/<repo> --json owner,isArchived,isFork
gh api repos/<owner>/<repo>/contents/.github/dependabot.yml --jq .path  # 404 → warn
gh api repos/<owner>/<repo>/contents/.github/workflows --jq length     # 404 → no-CI caveat
```

Owner must be `bostonaholic`; refuse archived repos; warn on forks
(Dependabot does not run on forks). No `dependabot.yml` → warn that the app
will sit idle except for security-update PRs, but proceed. No workflows →
the no-CI caveat above: confirm with the user before continuing.

## Step 2 — install (API)

1. Resolve the installation id and current repo selection (id was
   `155737060` at the time of writing; this read always re-resolves it):

   ```bash
   cd dependabot-shepherd && node --env-file=.env --input-type=module -e '
   import { createAppAuth } from "@octokit/auth-app";
   const auth = createAppAuth({ appId: process.env.APP_ID,
     privateKey: process.env.PRIVATE_KEY.replace(/\\n/g, "\n") });
   const { token: jwt } = await auth({ type: "app" });
   const installs = await (await fetch("https://api.github.com/app/installations",
     { headers: { Authorization: `Bearer ${jwt}` } })).json();
   if (!installs.length) { console.log("NOT INSTALLED"); process.exit(1); }
   const { token } = await auth({ type: "installation", installationId: installs[0].id });
   const body = await (await fetch("https://api.github.com/installation/repositories?per_page=100",
     { headers: { Authorization: `Bearer ${token}` } })).json();
   console.log(installs[0].id); body.repositories.forEach(r => console.log(r.full_name));'
   ```

   `NOT INSTALLED` means the app was uninstalled from the account: stop and
   follow the Setup section of `dependabot-shepherd/README.md`.

2. Skip to Step 3 if the repo is already in the printed list.

3. Add the repo (expect HTTP 204; `DELETE` on the same URL removes one — a
   422 there means the removal would empty the installation):

   ```bash
   PAT=$(grep '^GITHUB_PAT=' dependabot-shepherd/.env | cut -d= -f2)
   REPO_ID=$(gh api repos/<owner>/<repo> --jq .id)
   curl -s -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $PAT" \
     "https://api.github.com/user/installations/<id>/repositories/$REPO_ID"
   ```

4. Re-run the read from item 1 and confirm the repo is now listed.

**If `GITHUB_PAT` is missing or revoked** (non-expiring, so rare): it is a
classic PAT with `repo` scope the user mints at
<https://github.com/settings/tokens/new> and pastes into `.env` themselves.
It is user-level, not app-specific — the working copy in
`task-list-completed/.env` (same variable name) can be copied over.

**Browser fallback** (only if the API path is unavailable): manage at
<https://github.com/settings/installations> → **Configure** next to
`dependabot-shepherd-bostonaholic`. Keep **Only select repositories** — do
not flip to "All repositories". In the repo picker, wait ~1 s before typing
(early keystrokes leak to GitHub's global hotkeys) and pick the entry by its
exact accessible name — substring matches collide. Save, then reload the
page to confirm persistence.

## Step 3 — configure

**Config file — usually none.** The app works with zero config (defaults:
merge patch and minor, never majors; squash merges; rebase comments on).
Only add `.github/dependabot-shepherd.yml` in the target repo when the user
wants non-default behavior — schema in the Configuration section of
`dependabot-shepherd/README.md`. Do not commit a config file that just
restates defaults.

**No status check to require.** Unlike task-list-completed, the app reports
no commit status or check run — it is an actor, not a gate. Leave branch
protection exactly as it is; the app defers to it via native auto-merge.

**Per-PR escape hatch.** A PR labeled `shepherd: ignore` is never touched.
Only if the user wants the label ready ahead of time:

```bash
gh label create "shepherd: ignore" --repo <owner>/<repo> \
  --description "dependabot-shepherd leaves this PR alone" --color ededed
```

## Verify

- Installation: the Step 2 read lists the repo.
- Live behavior cannot be exercised on demand — nothing can make Dependabot
  open a PR now, and the live e2e (`e2e-dependabot-shepherd` skill) runs
  only against a local dev app and the sandbox repo, never the production
  app. The real check is the next Dependabot PR on the repo: the app
  approves and merges it (or leaves it alone, per policy) — visible in the
  PR timeline and the app's Recent Deliveries.

## Report

End by telling the user what was installed/configured, plus any Step 1
warnings (no `dependabot.yml`, no CI).
