# AGENTS.md

Agent guidance for the `dependabot-shepherd` app. See `README.md` for what
the app does, setup, and configuration. User-visible changes get an entry
under `[Unreleased]` in `CHANGELOG.md` (convention in the root `AGENTS.md`).

## Commands

```bash
npm test                          # vitest unit tests
npx vitest run test/parse.test.ts # single test file
npm run typecheck                 # tsc --noEmit
npm run build                     # tsc → lib/
npm start                         # probot run ./lib/index.js
npm run test:e2e                  # live e2e against bostonaholic/shepherd-sandbox
```

## Architecture

TypeScript ESM (`"type": "module"`, NodeNext) — relative imports must use the
`.js` extension. Source compiles from `src/` to `lib/`; Probot runs the
compiled output, so build before starting the server.

Strict layering, pure core with I/O at the edges:

- `src/parse.ts` — pure: Dependabot PR metadata extraction (title/body
  regexes, grouped updates, tolerant version-bump math, security markers)
- `src/policy.ts` — pure: config defaults, per-package glob overrides, and
  `decide()` — whether a PR's updates clear the policy; owns `IGNORE_LABEL`
- `src/shepherd.ts` — orchestration: `reconcile()` fetches the PR, guards on
  authorship, ensures a single approval at the head SHA, then the auto-merge
  ladder (native auto-merge → direct merge on green fallback)
- `src/rebase.ts` — orchestration: on default-branch pushes, comments
  `@dependabot rebase` on stale Dependabot PRs, deduped per head commit
- `src/index.ts` — Probot event wiring only; reads
  `.github/dependabot-shepherd.yml` and delegates
- `api/github/webhooks/index.js` — Vercel serverless entry point wrapping
  the compiled app (see README "Deploy"); changing the webhook path or the
  env-var contract touches this file and `vercel.json`

Unit tests in `test/` mirror this split (parser, policy, and the two
orchestrators with a structural fake octokit — no mocking framework).

Behavioral invariants to preserve:

- The app only ever acts on PRs where the author is `dependabot[bot]`
  (a Bot) **and** the head ref starts with `dependabot/`. The single
  exception is the env-gated e2e seam: `E2E_ALLOW_AUTHOR=<login>` accepts
  that author too. It must never be set in production.
- Unparseable titles and `unknown` bumps are treated like majors: skip with
  a warning log, no comment, no status. The app is an actor, not a gate —
  when disabled or unsure it does nothing at all, so it can never wedge a PR.
- Approvals are idempotent per head SHA. The app is not subscribed to
  `pull_request_review` or `issue_comment`, so its own approvals and rebase
  comments cannot re-trigger it.
- Every handler is fetch-then-act (`reconcile()` converges): webhook
  redeliveries and event storms must stay safe to replay.
- `app.yml` is the source of truth for the app's permissions and webhook
  events. Subscribing to a new event in `index.ts` requires adding it to
  `app.yml` too (and existing installations must accept the new permissions).
