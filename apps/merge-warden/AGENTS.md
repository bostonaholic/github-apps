# AGENTS.md

Agent guidance for the `merge-warden` app. See `README.md` for what the
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

- `src/config.ts` — pure: repo config defaults and normalization, and the
  two label names the app reads
- `src/signals.ts` — pure: path globs and diff size → one-way-door
  reasons, risk floor, and whether the diff can be graded whole
- `src/grade.ts` — pure: signals + model assessment + labels → `Grade`
- `src/policy.ts` — pure: scope test, `gradeVerdict` (stored once per
  commit as the check conclusion), and `liveBlock` / `mergeDecision`
  (run on every event against fresh facts). The one-way-door test is the
  first branch of both; thresholds are constants here
- `src/checks.ts` — I/O: `checksRollup` over check runs and commit
  statuses; a copy of dependabot-shepherd's with three differences listed
  in its header
- `src/format.ts` — pure: check-run title and markdown; `plainText`
  flattens every untrusted string before it is rendered
- `src/assess.ts` — I/O: the one model call (`client.messages.parse` with
  a zod schema); returns `null` on refusal, truncation, schema failure,
  or any SDK error
- `src/automerge.ts` — I/O: arm and disarm GitHub's native auto-merge
  (GraphQL), and `requiresOwnCheck`, the test for whether arming is safe
  on a branch
- `src/gate.ts` — I/O: `reconcile()`, the single orchestration entry
  point; the app's own check run on the head commit is the only stored
  state
- `src/index.ts` — Probot event wiring only; reads
  `.github/merge-warden.yml`, maps each event to a `Mode`, and delegates
- `api/github/webhooks/index.js` — Vercel serverless entry point wrapping
  the compiled app (see README "Deploy"); changing the webhook path or the
  env-var contract touches this file and `vercel.json`

Unit tests in `test/` mirror this split (no mocking framework — hand-written
structural fake octokits where needed).

Behavioral invariants to preserve:

- A one-way-door pull request is never approved, never armed for
  auto-merge, and never merged by this app. No config value, label, or
  model output reverses a one-way-door verdict.
- Every handler is fetch-then-act: `reconcile()` re-reads the pull request
  and converges, so webhook order and redelivery do not matter.
- Only `grade` and `regrade` events may call the model. `act` events
  (checks, statuses, reviews) reuse the stored verdict.
- Config is read from the default branch, never from the pull request
  head.
- The check run never concludes `failure`. `success` means eligible,
  `neutral` means a person merges, so a required `merge-warden` check
  cannot block a manual merge.
- Own check runs are found by app id, never by name alone.
- The approval and the merge are pinned to the graded commit
  (`commit_id`, `sha`). After a grade, `reconcile()` re-reads the pull
  request and stops if the head, the state, or the scope changed.
- Labels, draft state, and reviews are read live on every event. A stored
  `success` never overrides them.
- Nothing the model wrote goes into a review body.
- Disarm comes first. `reconcile()` disarms app-armed auto-merge before
  it grades and before it publishes any verdict, because GitHub keeps
  auto-merge armed across pushes and a `neutral` check satisfies a
  required check. If the disarm call throws, nothing else runs.
- Auto-merge is armed only where branch protection requires the
  `merge-warden` check pinned to this app's id. Everywhere else the app
  merges directly.
- The app disarms only auto-merge it armed. A person's auto-merge is
  never touched.
- The model never sees a partial diff. A diff that cannot be sent whole
  is not graded.
- `app.yml` is the source of truth for the app's permissions and webhook
  events. Subscribing to a new event in `index.ts` requires adding it to
  `app.yml` too (and existing installations must accept the new permissions).
