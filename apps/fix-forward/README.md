# fix-forward

A GitHub App that asks a coding agent to fix forward when CI on the default branch goes red.

When CI on the default branch goes red, fix-forward opens one
`main-broken` issue naming the culprit pull request and quoting each
failing check's log, then mentions a coding agent on it. The agent finds
the root cause and opens a fix PR that closes the issue. For repos where
merges land with no person watching (for example through merge-warden),
so a red default branch gets an owner within one CI run.

The app writes no code, calls no model, and never reverts, pushes,
merges, or touches another pull request. The fix PR goes through review
like any other PR.

## Behavior

On every `check_suite` completion and non-pending `status` for a commit
on the default branch, the app re-reads the branch and converges:

1. **Red or green.** Only checks named in `ci_checks` count. A commit is
   red when any named check failed, green when every named check
   succeeded, and unsettled otherwise (running, skipped, not reported).
   The branch's state is its newest settled commit.
2. **Flake filter.** Each red commit's failed GitHub Actions jobs are
   re-run once (`rerun-failed-jobs`). A workflow run already on attempt
   2 or later is a real failure. A failing check that is not from
   Actions cannot be re-run and is a real failure at once.
3. **Culprit.** The app walks back (up to 100 commits) to the last green
   commit. The culprit is the oldest confirmed-red commit after it, and
   the pull request merged as that commit. With no green commit found,
   or no merged PR for that commit (a direct push), the culprit is
   "unknown" and the issue lists the commits walked.
4. **One issue per red streak.** The issue carries the culprit PR and
   merge commit with a diff link, the commit range since the last green
   commit, each failing check's job, failing step, and the last
   `log_lines` lines of that step's log, and the task: fix the root
   cause forward in a new PR that closes the issue, with no revert and no
   skipped or deleted tests.
5. **Trigger.** One comment on the issue mentions `agent_handle`. The
   agent must accept comments from `fix-forward-bostonaholic[bot]`; many
   agent integrations ignore bot comments unless the bot is allowed.
6. **Streak tracking.** Newly red commits while the issue is open are
   appended to it; the agent is not mentioned again. When the branch
   turns green, the app closes the issue with a comment naming the
   fixing commit.
7. **Manual close wins.** If a person closes the issue while the branch
   is still red, no new issue opens until the branch has been green at
   least once.

If no fix arrives, the branch stays red until a person acts.

## Configuration

`.github/fix-forward.yml` on the default branch (Probot also falls back
to the owner's `.github` repo):

```yaml
enabled: true          # false switches the app off for this repo
ci_checks: [test]      # check runs / status contexts that are CI; none → app does nothing
agent_handle: "@claude"
log_lines: 50          # 1–200
```

`ci_checks` means what it means in merge-warden: a check is not CI
unless named. With no `ci_checks`, or no config file, the app does
nothing.

## Setup

### 1. Register the app

```bash
npm install
npm start
```

With no `.env` configured, Probot serves a setup page at
<http://localhost:3000> that registers the app from [`app.yml`](./app.yml)
as `fix-forward-bostonaholic` and writes credentials to `.env`.
GitHub App names are globally unique across GitHub, so every app in this
repo registers with the `-bostonaholic` suffix (see the root `AGENTS.md`,
"App registration names"). Alternatively, register manually and fill in
[`.env.example`](./.env.example).

Required permissions and events (declared in `app.yml`):

- **Issues: write** — open, append to, and close the `main-broken`
  issue; create its label; post the comment that triggers the agent.
- **Actions: write** — re-run failed jobs once, and read workflow runs,
  jobs, and job logs.
- **Checks: read** — check runs on default-branch commits, and the
  `check_suite` webhook.
- **Commit statuses: read** — combined commit status and the `status`
  webhook (legacy CI).
- **Contents: read** — default-branch commit history and the repo config
  file.
- **Pull requests: read** — the pull request merged as a red commit (the
  culprit).
- **Events:** `check_suite`, `status`.

### 2. Install it on repos

Install the app on the repositories (or the whole org) it should act on.

### 3. Deploy

See [Deploy](#deploy) below to host it, or run it locally for development.

## Deploy

The app is hosted on Vercel at
<https://fix-forward.bostonaholic.dev>. Pushing to `main` deploys
automatically via Vercel's git integration; the Vercel project's Root
Directory is `apps/fix-forward`, and `vercel.json`'s `ignoreCommand` skips
builds for commits that don't touch this app.

- **Entry point**: [`api/github/webhooks/index.js`](./api/github/webhooks/index.js)
  wraps the compiled app (`lib/index.js`) in Probot's `createNodeMiddleware`;
  `vercel.json`'s `buildCommand` runs `tsc` before functions are bundled.
- **Env vars** (Vercel project settings): `APP_ID`, `WEBHOOK_SECRET`,
  `PRIVATE_KEY`, and `NODEJS_HELPERS=0` (stops Vercel consuming the request
  body — signature verification needs the raw body). Never set
  `WEBHOOK_PROXY_URL` in production.
- **DNS**: `fix-forward` CNAME on bostonaholic.dev (Namecheap) →
  `cname.vercel-dns.com`.
- **Health probes** (no code): `GET /` serves the static landing page
  (DNS/TLS); `GET /api/github/webhooks` returns 404 JSON from a healthy
  function — a 500 there means bad credentials in the Vercel env.
- **Monitoring**: webhook health lives in the Vercel dashboard under the
  project's **Observability** (invocations, errors, duration) and **Logs**
  tabs — Web Analytics never sees webhook POSTs. The landing page loads the
  Web Analytics snippet (`/_vercel/insights/script.js`); enable Web
  Analytics on the new Vercel project (dashboard → **Analytics**) so page
  visits start collecting — until then the script 404s harmlessly.
- The GitHub App registration's webhook URL points at
  `https://fix-forward.bostonaholic.dev/api/github/webhooks`.
- **Rollback**: repoint the webhook URL back at the smee channel kept as
  `WEBHOOK_PROXY_URL` in `.env`
  (`node --env-file=.env ../../scripts/repoint-webhook.mjs <smee-url>`), run
  `npm start` locally, and redeliver anything missed from the app's Recent
  Deliveries (retained ~30 days).

## Development

```bash
npm test          # vitest unit tests
npm run typecheck # tsc --noEmit
npm run build     # tsc → lib/
npm start         # probot run ./lib/index.js (set WEBHOOK_PROXY_URL for local webhooks)
```

The production app registration's webhook URL points at the hosted
deployment, so a local `npm start` + smee receives no events. For
interactive webhook debugging, register a separate dev app
(`fix-forward-dev-bostonaholic`, via the empty-`.env` setup flow) with
its own smee channel, installed only on a sandbox repo — never repoint
the production app's webhook URL at smee. Set the sandbox repo's watch
status to **Ignore** (repo page → Watch → Ignore) so sandbox churn —
PRs, comments, and any deliberately failing e2e workflow runs — sends
no notifications.

Source layout: see [`AGENTS.md`](./AGENTS.md), "Architecture". The live
e2e (`npm run test:e2e`) is a stub until `e2e.sh` is implemented; its
planned scenarios are in `.claude/skills/e2e-fix-forward/SKILL.md`.
