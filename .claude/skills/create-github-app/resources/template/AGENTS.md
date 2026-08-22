# AGENTS.md

Agent guidance for the `__APP_NAME__` app. See `README.md` for what the
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

<!-- TODO(scaffold): a bullet per src/ module as they are designed. -->
- `src/config.ts` — pure: repo config defaults and normalization
- `src/index.ts` — Probot event wiring only; reads
  `.github/__APP_NAME__.yml` and delegates
- `api/github/webhooks/index.js` — Vercel serverless entry point wrapping
  the compiled app (see README "Deploy"); changing the webhook path or the
  env-var contract touches this file and `vercel.json`

Unit tests in `test/` mirror this split (no mocking framework — hand-written
structural fake octokits where needed).

Behavioral invariants to preserve:

<!-- TODO(scaffold): the app-specific invariants go first here. -->
- `app.yml` is the source of truth for the app's permissions and webhook
  events. Subscribing to a new event in `index.ts` requires adding it to
  `app.yml` too (and existing installations must accept the new permissions).
