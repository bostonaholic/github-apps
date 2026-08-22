# task-list-completed

A GitHub App that turns markdown checkboxes into a merge gate.

Anywhere someone writes `- [ ]` on a pull request — the description, a
comment, a review, or a review comment — this app counts it as a task. While
any task is unchecked, it reports a **red `task-list-completed` commit
status** on the PR's head commit. Pair that with a branch protection rule
requiring the status and the PR cannot merge until every box is ticked.

It also maintains a single sticky comment on the PR listing what's still
outstanding, with each item linked back to wherever it was written — no
scrolling a long thread hunting for the one unchecked box.

Typical use: things that must happen before merge, like running a migration
or getting a sign-off.

## What counts as a task

Any GitHub-flavored-markdown task list item, in any of the four places:

```markdown
- [ ] unchecked (blocks merge)
- [x] checked
* [ ] also works, as do + and ordered lists (1. / 1))
```

Checkboxes inside fenced code blocks (``` or ~~~) are ignored. The app
recounts on every relevant event: PR opened/edited/synchronized, comments and
review comments created/edited/deleted, reviews submitted/edited/dismissed,
and labels changed.

## The status

| Situation | Status | Description |
| --- | --- | --- |
| Any unchecked task | 🔴 `failure` | `N of M tasks remaining` |
| All tasks checked | 🟢 `success` | `All M tasks complete` |
| No tasks anywhere | 🟢 `success` | `No tasks found` |
| Gate disabled (see below) | 🟢 `success` | `Task list checks are disabled` |

The status links to the sticky comment when one exists.

## Switching it off

The gate can be disabled at three levels. Disabling still reports a green
status, so a branch protection rule requiring it never wedges a PR.

| Scope | How |
| --- | --- |
| Repo | `.github/task-list.yml` containing `enabled: false` (or don't install the app on that repo). An org-wide default can live in the org's `.github` repo. |
| PR | Put `<!-- task-list: disable -->` in the PR description, or add the `task-list: disabled` label. |
| Comment | Put `<!-- task-list: ignore -->` in any single description/comment/review whose checkboxes are just notes, not gates. |

## Setup

### 1. Register the app

```bash
npm install
npm start
```

With no `.env` configured, Probot serves a setup page at
<http://localhost:3000> that registers the app from [`app.yml`](./app.yml)
as `task-list-completed-bostonaholic` and writes credentials to `.env`.
GitHub App names are globally unique across GitHub, so every app in this
repo registers with the `-bostonaholic` suffix (see the root `AGENTS.md`,
"App registration names"). Alternatively, register manually and fill in
[`.env.example`](./.env.example).

Required permissions and events (declared in `app.yml`):

- **Pull requests: read & write** — read PRs/comments/reviews, write the sticky comment
- **Issues: read & write** — required for the `issue_comment` webhook event; sticky comment CRUD uses the issues API
- **Commit statuses: read & write** — report the status
- **Contents: read** — read `.github/task-list.yml`
- Events: `pull_request`, `issue_comment`, `pull_request_review`, `pull_request_review_comment`

### 2. Install it on repos

Install the app on the repositories (or the whole org) that should be gated.

### 3. Require the status

In each repo: **Settings → Branches → Branch protection rules → Require
status checks to pass before merging**, and select `task-list-completed`.
The check appears in the list after the app has reported at least once.

## Deploy

The app is hosted on Vercel at
<https://task-list-completed.bostonaholic.dev>. Pushing to `main` deploys
automatically via Vercel's git integration; the Vercel project's Root
Directory is `task-list-completed`, and `vercel.json`'s `ignoreCommand`
skips builds for commits that don't touch this app.

- **Entry point**: [`api/github/webhooks/index.js`](./api/github/webhooks/index.js)
  wraps the compiled app (`lib/index.js`) in Probot's `createNodeMiddleware`;
  `vercel.json`'s `buildCommand` runs `tsc` before functions are bundled.
- **Env vars** (Vercel project settings): `APP_ID`, `WEBHOOK_SECRET`,
  `PRIVATE_KEY`, and `NODEJS_HELPERS=0` (stops Vercel consuming the request
  body — signature verification needs the raw body). Never set
  `WEBHOOK_PROXY_URL` in production.
- **DNS**: `task-list-completed` CNAME on bostonaholic.dev (Namecheap) →
  `cname.vercel-dns.com`.
- **Health probes** (no code): `GET /` serves the static landing page
  (DNS/TLS); `GET /api/github/webhooks` returns 404 JSON from a healthy
  function — a 500 there means bad credentials in the Vercel env.
- **Timeout ceiling**: functions are capped at 30 seconds (`maxDuration` in
  [`vercel.json`](./vercel.json)). A normal run is a handful of API calls,
  but a PR with hundreds of comments/reviews paginates all four task
  sources and can hit the cap. Hitting it kills the function mid-run: the
  Vercel function logs show a timeout, and the PR is left with a stale (or
  forever-"Expected") `task-list-completed` status because the run died
  before reporting. If that happens, raise `maxDuration` (the ceiling is
  plan-dependent — check Vercel's limits docs) before hunting for a code
  bug.
- The GitHub App registration's webhook URL points at
  `https://task-list-completed.bostonaholic.dev/api/github/webhooks`.

## Development

```bash
npm test                       # vitest: parser, formatter, and orchestration tests
E2E_HOSTED=1 npm run test:e2e  # live e2e against the deployed app (see e2e.sh)
npm run test:e2e               # live e2e against a locally started server
npm run build                  # tsc → lib/
npm start                      # probot run ./lib/index.js (set WEBHOOK_PROXY_URL for local webhooks)
```

The production app registration's webhook URL points at the hosted
deployment, so a local `npm start` + smee receives no events. Day to day:
unit tests locally, then `E2E_HOSTED=1 npm run test:e2e` against production
after merging. For interactive webhook debugging, register a separate dev
app (`task-list-completed-dev-bostonaholic`, via the empty-`.env` setup
flow) with its own smee channel, installed only on the sandbox repo — never
repoint the production app's webhook URL at smee.

In local mode the e2e run builds and starts the app server itself (stopping
it when done; an already-running server is reused). It needs `.env` and the
app installed on the sandbox repo; in hosted mode it needs only `gh`. The
`e2e-task-list-completed` project skill covers preconditions and failure
triage.

Source layout:

- `src/parse.ts` — pure: task extraction, code-fence stripping, control markers
- `src/format.ts` — pure: commit status and sticky-comment bodies
- `src/checklist.ts` — orchestration: fetch sources, compute state, sync status + comment
- `src/index.ts` — Probot event wiring
