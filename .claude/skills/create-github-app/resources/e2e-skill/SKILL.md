---
name: e2e-__APP_NAME__
description: Run the live end-to-end verification of the __APP_NAME__ GitHub App against the bostonaholic/__APP_NAME__-sandbox repo. Use when asked to "run the e2e test", "verify the app end to end", "e2e __APP_NAME__", or after changing the app when live verification is wanted.
---

# E2E verification: __APP_NAME__

<!-- TODO(scaffold): one paragraph — what the run drives in the sandbox
and what it asserts, from the app's design. -->

The whole run is scripted in `apps/__APP_NAME__/e2e.sh`; this skill
covers preconditions, one-time sandbox setup, and failure triage.

**Status: `e2e.sh` is a stub** and exits 1 with `e2e not implemented`.
Implement it to the table below (models: the other apps' `e2e.sh`),
then delete this paragraph.

## What it verifies

<!-- TODO(scaffold): the planned scenarios, one row each, from the app's
design — every webhook event in app.yml and every behavioral invariant
in AGENTS.md is covered by at least one row, including the negative
cases (the app must leave a PR untouched). -->

| Step | Scenario | Expected |
| --- | --- | --- |

## Preconditions

0. **A dev app registration.** The production app is hosted on Vercel
   (<https://__APP_NAME__.bostonaholic.dev>) and its webhook URL points
   there — a local server on smee receives nothing from the production
   registration. The live e2e needs a separate dev app
   (`__APP_NAME__-dev-bostonaholic`, registered via the empty-`.env`
   setup flow, installed only on the sandbox) whose webhook points at a
   smee channel, with its credentials in the local `.env`. Never repoint
   the production app's webhook at smee.
1. **`apps/__APP_NAME__/.env`** — the (dev) app's credentials. If
   missing, the app has never been registered on this machine — stop and
   follow the Setup section of `apps/__APP_NAME__/README.md` instead of
   guessing.
2. **`gh` authenticated** with push access to
   `bostonaholic/__APP_NAME__-sandbox`.
3. **App installed on the sandbox repo**
   (<https://github.com/settings/installations>).
4. **Sandbox prepared** (one-time, see below).

## One-time sandbox setup

```bash
gh repo create bostonaholic/__APP_NAME__-sandbox --private --add-readme
```

<!-- TODO(scaffold): any fixtures the scenarios need (workflows, labels,
files), as commands; delete this comment if none. -->

Then install the dev app on the sandbox repo, and set the sandbox repo's
watch status to **Ignore** (repo page → Watch → Ignore): e2e churn —
PRs, comments, and any deliberately failing workflow runs — otherwise
emails whoever triggers it, and GitHub has no per-repo Actions
notification setting.

## Run

```bash
cd apps/__APP_NAME__ && npm run test:e2e
```

The script builds the current source, starts the app server (or reuses
one already listening on :3000 — a reused server may run stale code),
prints one `== step` header per table row, and ends with `E2E PASS`.
Positive assertions poll up to `E2E_POLL_TIMEOUT` seconds; the sandbox
repo can be overridden with `E2E_REPO`. Cleanup closes the PRs it opened
and deletes their branches on pass and fail.

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
<!-- TODO(scaffold): one bullet per scenario whose failure points at a
specific src/ module. -->
- Do not retry a failed run more than once before diagnosing: the run is
  deterministic apart from webhook and Actions delivery delays.
