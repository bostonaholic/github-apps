---
name: e2e-fix-forward
description: Run the live end-to-end verification of the fix-forward GitHub App against the bostonaholic/fix-forward-sandbox repo. Use when asked to "run the e2e test", "verify the app end to end", "e2e fix-forward", or after changing the app when live verification is wanted.
---

# E2E verification: fix-forward

Merges real PRs into `main` of `bostonaholic/fix-forward-sandbox` that
make its `test` workflow fail, flake, or pass, and asserts the app's
re-runs, its `main-broken` issues (culprit, failing step, log tail,
marker), its one trigger comment per issue, and the issue's close when
`main` turns green.

The whole run is scripted in `apps/fix-forward/e2e.sh`; this skill
covers preconditions, one-time sandbox setup, and failure triage.

**Status: `e2e.sh` is a stub** and exits 1 with `e2e not implemented`.
Implement it to the table below (models: the other apps' `e2e.sh`),
then delete this paragraph.

## What it verifies

| Step | Scenario | Expected |
| --- | --- | --- |
| 1 | PR adds `e2e/flaky` (the `test` job fails on attempt 1 only), merged | the workflow run reaches attempt 2 via the app's re-run and passes; no `main-broken` issue; the PR untouched |
| 2 | PR adds `e2e/fail` (the `test` job always fails), merged | one re-run (attempt 2), then one open `main-broken` issue titled `main is red: after #<pr>`, naming the merge commit, job `test`, step `Run tests`, and the log tail; exactly one comment mentioning `agent_handle` |
| 3 | Direct push of another commit to `main` while `e2e/fail` remains | the same issue gains a section for the new commit (marker `reported` lists both); no second issue; still one trigger comment |
| 4 | PR deletes `e2e/fail`, merged | the issue is closed with a comment naming the fix commit |
| 5 | PR adds `e2e/fail`, merged; the script closes the new issue by hand; another failing commit is pushed; then a fix PR merged; then `e2e/fail` added again | no issue opens while red after the manual close; after green, a new issue opens with marker `base` = the green commit |
| 6 | On a green `main` head, the script posts a failing commit status with context `test` | an issue opens with no re-run (the failure is not from Actions); its section says there is no log |
| 7 | PR adds `e2e/lint-fail` (only the `lint` job, not in `ci_checks`, fails), merged; a pushed non-default branch with `e2e/fail` | no re-run and no issue for either |
| 8 | Config commit sets `enabled: false`, then `e2e/fail` merged | no re-run and no issue; the script restores `enabled: true` and cleans up |

The app reacts to `check_suite` (steps 1–5, 7, 8) and `status` (step 6).

## Preconditions

0. **A dev app registration.** The production app is hosted on Vercel
   (<https://fix-forward.bostonaholic.dev>) and its webhook URL points
   there — a local server on smee receives nothing from the production
   registration. The live e2e needs a separate dev app
   (`fix-forward-dev-bostonaholic`, registered via the empty-`.env`
   setup flow, installed only on the sandbox) whose webhook points at a
   smee channel, with its credentials in the local `.env`. Never repoint
   the production app's webhook at smee.
1. **`apps/fix-forward/.env`** — the (dev) app's credentials. If
   missing, the app has never been registered on this machine — stop and
   follow the Setup section of `apps/fix-forward/README.md` instead of
   guessing.
2. **`gh` authenticated** with push access to
   `bostonaholic/fix-forward-sandbox`.
3. **App installed on the sandbox repo**
   (<https://github.com/settings/installations>).
4. **Sandbox prepared** (one-time, see below).

## One-time sandbox setup

```bash
gh repo create bostonaholic/fix-forward-sandbox --private --add-readme
```

Fixtures, committed to the sandbox's `main`:

- `.github/workflows/ci.yml` with two jobs on `push` to every branch and
  on `pull_request`:
  - `test` — one step named `Run tests` that runs `exit 1` when
    `e2e/fail` exists, and also when `e2e/flaky` exists and
    `github.run_attempt` is `1`; otherwise prints a line and exits 0.
  - `lint` — exits 1 when `e2e/lint-fail` exists.
- `.github/fix-forward.yml`:

  ```yaml
  ci_checks: [test]
  agent_handle: "@fix-forward-e2e-agent"
  log_lines: 20
  ```

  Before first use, confirm `https://github.com/fix-forward-e2e-agent`
  is a 404, so the trigger comment notifies no real account.

Then install the dev app on the sandbox repo, and set the sandbox repo's
watch status to **Ignore** (repo page → Watch → Ignore): e2e churn —
PRs, comments, and any deliberately failing workflow runs — otherwise
emails whoever triggers it, and GitHub has no per-repo Actions
notification setting.

## Run

```bash
cd apps/fix-forward && npm run test:e2e
```

The script builds the current source, starts the app server (or reuses
one already listening on :3000 — a reused server may run stale code),
prints one `== step` header per table row, and ends with `E2E PASS`.
Positive assertions poll up to `E2E_POLL_TIMEOUT` seconds; the sandbox
repo can be overridden with `E2E_REPO`. Cleanup closes the PRs and issues it opened,
deletes their branches, and restores `main`'s fixtures on pass and fail.

## Interpreting failures

- **Server startup failure**: the script prints the server log tail — a
  crash on boot points at the code or `.env`; a proxy-connect timeout
  points at smee.io or the network.
- **Timeout on step 1**: webhooks are not reaching the server — smee
  channel mismatch, or the app is not installed on the sandbox. A healthy
  run logs a `POST /api/github/webhooks 200` per event.
- **Timeout or wrong result on a later step**: the app received earlier
  events but computed the wrong result for this one — a real regression.
  Compare what the script last saw with the Expected column.
- **Step 1 opens an issue, or never re-runs**: `flakeReruns` in
  `src/verdict.ts` (attempt check) or the `check_suite` → workflow run
  mapping in `src/checks.ts`.
- **Step 2 names the wrong culprit or step, or shows the wrong log
  lines**: `readHistory` in `src/history.ts` (culprit), `findCulprit` in
  `src/reconcile.ts` (PR), or `stepLogTail` in `src/report.ts` (log).
- **Step 2 or 3 posts a second trigger comment**: `triggerAgentOnce` in
  `src/issues.ts`.
- **Step 3 opens a second issue**: the marker round-trip
  (`parseMarker`/`formatMarker` in `src/report.ts`) or
  `listStreakIssues` in `src/issues.ts`.
- **Step 4 leaves the issue open**: `walkDone` with `wantFixing` in
  `src/history.ts`, or the green branch of `reconcile()`.
- **Step 5 opens an issue after the manual close**: the same-streak test
  in `reconcile()` (`src/reconcile.ts`).
- **Step 6 re-runs, or opens nothing**: `commitVerdict` status handling
  in `src/verdict.ts`, or the `status` wiring in `src/index.ts`.
- **Step 7 or 8 acts**: `ci_checks` filtering in `commitVerdict`, the
  branch or `enabled` guard at the top of `reconcile()`.
- Do not retry a failed run more than once before diagnosing: the run is
  deterministic apart from webhook and Actions delivery delays.
