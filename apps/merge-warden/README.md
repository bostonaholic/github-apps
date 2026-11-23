# merge-warden

A GitHub App that grades pull requests on risk and auto-merges the low-risk two-way-door ones.

For solo repos where pull requests wait on one reviewer. The app grades
each pull request, reports the grade as a check run, and merges the ones
that are low risk and reversible. Everything else waits for a person.

## What it does

On every new head commit of a pull request that targets the default
branch, the app:

1. Reads the changed files and runs deterministic rules over the paths
   and the diff size.
2. Sends the diff (not the title or description) to Claude for a grade.
3. Writes a `merge-warden` check run on the head commit with the verdict,
   and posts the grade and findings as one comment on the pull request.
   Each new grade edits that comment instead of adding another.
4. If the pull request is eligible, approves it and merges it once CI is
   green.

### The grade

| Field | Values | Source |
| --- | --- | --- |
| Customer impact | low, medium, high | Claude |
| Data/security | low, medium, high | Claude |
| Recovery | low, medium, high | Claude |
| Door | one-way, two-way | configured paths, label, or Claude |
| Risk | highest of the three axes, the rule floor, and any finding | computed |
| Confidence | 0–100 | Claude |

Claude can raise the risk or declare a one-way door. It cannot lower a
result that a rule produced.

The comment shows each level with a traffic light: 🟢 Low, 🟡 Medium,
🔴 High. It shows the door as 🔄 Reversible (two-way) or ⛔ Irreversible
(one-way), and the decision as 🟢 Merge or 🔴 Review (a person merges).

### One-way doors

A one-way door is a change that a revert does not undo: once merged or
deployed, the prior state cannot be restored by reverting the commit. A
pull request is a one-way door when any of these is true:

- It carries the `one-way-door` label.
- A changed path (old or new name) matches `one_way_door_paths` in the
  repo config.
- Claude classifies the diff as one-way.

**One-way-door pull requests are never auto-merged.** No config value,
label, or grade reverses that. A person merges them.

Claude judges the door from what the diff does, not from file names: a
migration that runs on deploy, a published release, a changed public
contract, an external side effect, a committed credential, or applied
permissions or infrastructure. Editing `.env.example` is two-way. There are no built-in path rules; add
`one_way_door_paths` for paths your repo always wants a person to merge.

### When it merges

All of these must hold:

1. The door is two-way.
2. Risk is low and confidence is at least 90.
3. The author is in `authors`, the branch is in the same repo (no forks),
   and the base is the default branch.
4. The pull request is not a draft, has no changes requested, and does
   not carry the `no-auto-merge` label.
5. No check or commit status is failing or still running, and every
   check named in `ci_checks` has succeeded. A repo that names no
   `ci_checks` is never merged directly.

A pull request that fails condition 3 is out of scope: it is not graded
and gets no check run. For every other pull request the check run
concludes `success` when conditions 1 and 2 hold for the graded commit,
and `neutral` otherwise. It never concludes `failure`, so making
`merge-warden` a required check does not block a manual merge.
Conditions 4 and 5 are read again on every event, so they can stop a
merge after the check has concluded `success`.

### How it merges

- **Native auto-merge.** If branch protection on the base branch requires
  the `merge-warden` status check and pins it to this app, the app
  enables GitHub's auto-merge for the graded commit. GitHub merges when
  the branch's requirements pass.
- **Direct merge.** Everywhere else, and whenever GitHub refuses to
  enable auto-merge, the app merges directly, pinned to the graded
  commit, once every check named in `ci_checks` has succeeded and no
  other check or status is failing or running.

`ci_checks` exists because a successful check does not mean tests ran.
Deploy previews and status bots report success on every commit. Only the
names you list count as CI. Use the check run's name as GitHub shows it
(for Actions, the job name) or a commit-status context.

Why the condition: GitHub keeps auto-merge enabled across pushes by
anyone with write access. Without a required `merge-warden` check, a new
commit could merge before the app has graded it. With one, GitHub waits
for the app's verdict on the new commit, and the app turns auto-merge off
before it publishes a verdict that is not `success`. A requirement that
accepts the check name from any source does not count, and neither does
one set through a ruleset; those branches use the direct path.

The app turns native auto-merge back off, only when it was the one that
enabled it, as soon as a pull request stops being eligible: a new commit,
a `one-way-door` or `no-auto-merge` label, changes requested, a failing
check, conversion to draft, or a retarget to another base.

To use native auto-merge on a repo:

1. Repo settings → General → enable **Allow auto-merge**.
2. Branch protection on the default branch → **Require status checks to
   pass** → add `merge-warden` and select this app as its source.

### Changes that are high risk but reversible

Claude reports a change to what gates a merge (CI workflows, CODEOWNERS,
branch protection, `.github/merge-warden.yml`) as a high finding, so it
does not auto-merge. Paths in `high_risk_paths` get a high risk floor
whatever Claude says.

A diff over 400 changed lines or 20 files has a risk floor of medium.

### Diffs that are not graded

The app does not send a partial diff. A pull request gets `neutral` with
"not gradeable" when a changed file has no text patch (binary, very
large, submodule, or an empty new file), when it changes 300 or more
files, or when the diff exceeds the size budget.

## Configuration

Optional file `.github/merge-warden.yml` on the default branch:

```yaml
enabled: true
# Logins whose pull requests may be auto-merged. Default: the repo owner.
authors:
  - octocat
merge_method: squash # squash | merge | rebase
# The check runs or commit-status contexts that are this repo's CI. All
# must succeed before a direct merge. Default: none, so no direct merge.
ci_checks:
  - test
# Paths that always make a pull request a one-way door or high risk.
# Claude cannot relax them.
one_way_door_paths:
  - "db/**"
high_risk_paths:
  - "infra/**"
```

The risk and confidence thresholds are constants in `src/policy.ts`, not
config.

## Switching it off

- One pull request: add the `no-auto-merge` label. It is still graded.
- One repo: `enabled: false` in `.github/merge-warden.yml`.
- Everything: uninstall the app.

## Limits

- Confidence is not a security control. Text in a diff can make a model
  report high confidence. The controls are the author allowlist, your
  configured path rules, and your CI. With no `one_way_door_paths` or
  `high_risk_paths`, the door and the risk come from Claude alone.
- The author allowlist says who opened the pull request. It says nothing
  about where the content came from.
- With native auto-merge armed, a `one-way-door` label takes effect when
  GitHub delivers the webhook, a few seconds later. A merge that
  completes inside that window is not prevented.
- If the app is installed on the repo that holds its own source, add
  `high_risk_paths: ["apps/merge-warden/**"]` there.

## Setup

### 1. Register the app

```bash
npm install
npm start
```

With no `.env` configured, Probot serves a setup page at
<http://localhost:3000> that registers the app from [`app.yml`](./app.yml)
as `merge-warden-bostonaholic` and writes credentials to `.env`.
GitHub App names are globally unique across GitHub, so every app in this
repo registers with the `-bostonaholic` suffix (see the root `AGENTS.md`,
"App registration names"). Alternatively, register manually and fill in
[`.env.example`](./.env.example).

Required permissions and events (declared in `app.yml`):

- **Pull requests: write** — read pull requests and reviews, approve,
  enable and disable auto-merge, and post the grade comment (issue
  comments on a pull request need no Issues permission)
- **Contents: write** — merging creates a commit; also reading the diff
  and the repo config
- **Checks: write** — the app's own verdict check run, other apps' check
  runs for the rollup, and the `check_suite` and `check_run` webhooks
- **Commit statuses: read** — combined commit status and the `status`
  webhook (legacy CI)
- **Events:** `pull_request`, `pull_request_review`, `check_suite`,
  `check_run`, `status`

### 2. Install it on repos

Install the app on the repositories (or the whole org) it should act on.

### 3. Deploy

See [Deploy](#deploy) below to host it, or run it locally for development.

## Deploy

The app is hosted on Vercel at
<https://merge-warden.bostonaholic.dev>. Pushing to `main` deploys
automatically via Vercel's git integration; the Vercel project's Root
Directory is `apps/merge-warden`, and `vercel.json`'s `ignoreCommand` skips
builds for commits that don't touch this app.

- **Entry point**: [`api/github/webhooks/index.js`](./api/github/webhooks/index.js)
  wraps the compiled app (`lib/index.js`) in Probot's `createNodeMiddleware`;
  `vercel.json`'s `buildCommand` runs `tsc` before functions are bundled.
- **Env vars** (Vercel project settings): `APP_ID`, `WEBHOOK_SECRET`,
  `PRIVATE_KEY`, `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`, and
  `NODEJS_HELPERS=0` (stops Vercel
  consuming the request body — signature verification needs the raw
  body). Never set `WEBHOOK_PROXY_URL` in production. Without
  `ANTHROPIC_API_KEY` every pull request gets `neutral` "could not grade".
- **Function duration**: `vercel.json` sets `maxDuration` to 300 seconds.
  A grade can take longer than the 9 seconds after which the webhook
  middleware answers GitHub, so `src/index.ts` passes the work to
  `waitUntil` to keep the invocation alive until it settles. This needs
  Fluid compute enabled on the Vercel project.
- **Model**: `claude-haiku-5-5` by default (`src/assess.ts`). Set the
  optional `ANTHROPIC_MODEL` env var to use another model without a code
  change; redeploy for it to take effect. One call per
  graded commit, 100-second timeout, one retry. A refusal, a truncated
  response, or an API error means no grade, and a person merges.
- **DNS**: `merge-warden` CNAME on bostonaholic.dev (Namecheap) →
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
  `https://merge-warden.bostonaholic.dev/api/github/webhooks`.
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
(`merge-warden-dev-bostonaholic`, via the empty-`.env` setup flow) with
its own smee channel, installed only on a sandbox repo — never repoint
the production app's webhook URL at smee. Set the sandbox repo's watch
status to **Ignore** (repo page → Watch → Ignore) so sandbox churn —
PRs, comments, and any deliberately failing e2e workflow runs — sends
no notifications.

Source layout is listed in [`AGENTS.md`](./AGENTS.md). `npm run test:e2e`
runs the live end-to-end check against `bostonaholic/merge-warden-sandbox`
(`E2E_HOSTED=1` for the deployed app); setup and triage are in the
`e2e-merge-warden` skill.
