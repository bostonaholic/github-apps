# AGENTS.md

Agent guidance for the `task-list-completed` app. See `README.md` for what
the app does, setup, and configuration. User-visible changes get an entry
under `[Unreleased]` in `CHANGELOG.md` (convention in the root `AGENTS.md`).

## Commands

```bash
npm test                          # vitest unit tests
npx vitest run test/parse.test.ts # single test file
npm run typecheck                 # tsc --noEmit
npm run build                     # tsc → lib/
npm start                         # probot run ./lib/index.js
npm run test:e2e                  # live e2e against bostonaholic/task-list-sandbox
E2E_HOSTED=1 npm run test:e2e     # live e2e against the deployed app
```

The e2e run (`e2e.sh`) opens a real PR in the sandbox repo and asserts the
commit status and sticky comment after each mutation. In local mode it
builds and starts the app server itself, but requires `.env` (app
credentials — if missing, the app was never registered; see the README's
Setup) and an authenticated `gh` with access to the sandbox. A server
already listening on :3000 is reused — restart it if it may be running
stale code. With `E2E_HOSTED=1` it skips the server entirely and asserts
against the Vercel deployment (which runs the code merged to `main`, not
the working tree).
`../.claude/skills/e2e-task-list-completed/SKILL.md` documents preconditions
and failure triage; do not retry a failed run more than once before
diagnosing.

## Architecture

TypeScript ESM (`"type": "module"`, NodeNext) — relative imports must use the
`.js` extension. Source compiles from `src/` to `lib/`; Probot runs the
compiled output, so build before starting the server.

Strict layering, pure core with I/O at the edges:

- `src/parse.ts` — pure: GFM task extraction, code-fence stripping, control
  markers (`<!-- task-list: ignore/disable/sticky-comment -->`)
- `src/format.ts` — pure: builds the commit status and sticky-comment bodies;
  owns constants like `STATUS_CONTEXT` and `DISABLE_LABEL`
- `src/checklist.ts` — orchestration: fetches all four markdown sources
  (description, comments, reviews, review comments), computes task state,
  syncs the commit status and the single sticky comment
- `src/index.ts` — Probot event wiring only; reads `.github/task-list.yml`
  repo config and delegates to `runCheck`
- `api/github/webhooks/index.js` — Vercel serverless entry point wrapping
  the compiled app (see README "Deploy"); changing the webhook path or the
  env-var contract touches this file and `vercel.json`

Unit tests in `test/` mirror this split (parser, formatter, orchestration
with a mocked octokit).

Behavioral invariants to preserve:

- The sticky comment is identified by the `<!-- task-list: sticky-comment -->`
  marker; it must never re-trigger a run (`index.ts` filters it) nor be
  counted as a task source.
- Disabling at any level (repo config, PR marker/label, per-comment ignore)
  still reports a **green** status so a required check never wedges a PR.
- `app.yml` is the source of truth for the app's permissions and webhook
  events. Subscribing to a new event in `index.ts` requires adding it to
  `app.yml` too (and existing installations must accept the new permissions).
