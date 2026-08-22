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
(GitHub App names are globally unique — pick a variant if `task-list-completed`
is taken) and writes credentials to `.env`. Alternatively, register manually
and fill in [`.env.example`](./.env.example).

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

## Development

```bash
npm test          # vitest: parser, formatter, and orchestration tests
npm run test:e2e  # live end-to-end run against the sandbox repo (see e2e.sh)
npm run build     # tsc → lib/
npm start         # probot run ./lib/index.js (set WEBHOOK_PROXY_URL for local webhooks)
```

The e2e run builds and starts the app server itself (stopping it when done;
an already-running server is reused). It needs `.env` and the app installed
on the sandbox repo; the `e2e-task-list-completed` project skill covers
preconditions and failure triage.

Source layout:

- `src/parse.ts` — pure: task extraction, code-fence stripping, control markers
- `src/format.ts` — pure: commit status and sticky-comment bodies
- `src/checklist.ts` — orchestration: fetch sources, compute state, sync status + comment
- `src/index.ts` — Probot event wiring
