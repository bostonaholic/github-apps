# AGENTS.md

Agent guidance for the `fix-forward` app. See `README.md` for what the
app does, setup, and configuration. User-visible changes get an entry
under `[Unreleased]` in `CHANGELOG.md` (convention in the root `AGENTS.md`).

## Commands

```bash
npm test                           # vitest unit tests
npx vitest run test/config.test.ts # single test file
npm run typecheck                  # tsc --noEmit
npm run build                      # tsc → lib/
npm start                          # probot run ./lib/index.js
npm run test:e2e                   # stub — fails until e2e.sh is implemented
```

## Architecture

TypeScript ESM (`"type": "module"`, NodeNext) — relative imports must use the
`.js` extension. Source compiles from `src/` to `lib/`; Probot runs the
compiled output, so build before starting the server.

Strict layering, pure core with I/O at the edges:

- `src/config.ts` — pure: repo config defaults and normalization
- `src/verdict.ts` — pure: one commit's verdict over the `ci_checks`
  names (`commitVerdict`) and which failed Actions runs still owe their
  one flake re-run (`flakeReruns`)
- `src/history.ts` — pure: the branch's state from its commits newest
  first (`readHistory`) and when the walk may stop (`walkDone`)
- `src/report.ts` — pure: issue title, body, and marker; the trigger and
  closing comments; `stepLogTail`, the failing step's log excerpt
- `src/checks.ts` — I/O: reads one commit's check runs, statuses, and
  workflow runs into a `CommitEntry`
- `src/logs.ts` — I/O: one report per failing check with its job log
  tail; a fetch error becomes a note, never a thrown error
- `src/issues.ts` — I/O: finds the app's streak issues and makes every
  write to them
- `src/reconcile.ts` — I/O: `reconcile()`, the single orchestration entry
  point
- `src/index.ts` — Probot event wiring only; reads
  `.github/fix-forward.yml` and delegates
- `api/github/webhooks/index.js` — Vercel serverless entry point wrapping
  the compiled app (see README "Deploy"); changing the webhook path or the
  env-var contract touches this file and `vercel.json`

Unit tests in `test/` mirror this split (no mocking framework — hand-written
structural fake octokits where needed).

Behavioral invariants to preserve:

- The app never reverts, pushes, merges, or modifies a pull request. Its
  only writes are job re-runs and its own issues, label, and comments.
- Every handler is fetch-then-act: `reconcile()` re-reads the branch
  history and the streak issues and converges, so webhook order and
  redelivery do not matter. Two overlapping runs can still both open an
  issue: there is no lock.
- The marker in a streak issue's body (`base`, the last green commit
  before the streak, and `reported`, the red commits already in the
  issue) is the only stored state. Streak issues are found by label, by
  this app's bot login, and by the marker; never by title.
- Only checks named in `ci_checks` decide red and green. With none, or
  `enabled: false`, `reconcile()` makes no API call.
- Only events for commits on the default branch act, and config is read
  from the default branch.
- A failed Actions run is re-run at most once: a workflow run on attempt
  2 or later is never re-run. Non-Actions failures are never re-run.
- An issue opens only for a confirmed red commit. Each issue gets exactly
  one trigger comment, found by `AGENT_MARKER`.
- The newest streak issue decides: same `base` and open → append;
  same `base` and closed → do nothing (manual close wins); different
  `base` → close any open issue as superseded, then open a new one.
- A failed log fetch never stops the issue; it becomes a note in it.
- `app.yml` is the source of truth for the app's permissions and webhook
  events. Subscribing to a new event in `index.ts` requires adding it to
  `app.yml` too (and existing installations must accept the new permissions).
