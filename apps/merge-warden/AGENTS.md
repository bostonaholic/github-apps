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
- `src/gate.ts` — I/O: `reconcile()`, the single orchestration entry point
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
- `app.yml` is the source of truth for the app's permissions and webhook
  events. Subscribing to a new event in `index.ts` requires adding it to
  `app.yml` too (and existing installations must accept the new permissions).
