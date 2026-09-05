---
name: e2e-dependabot-shepherd
description: Run the live end-to-end verification of the dependabot-shepherd GitHub App against the bostonaholic/shepherd-sandbox repo. Use when asked to "run the e2e test", "verify the app end to end", "e2e dependabot-shepherd", or after changing the app when live verification is wanted.
---

# E2E verification: dependabot-shepherd

Simulates Dependabot PRs in `bostonaholic/shepherd-sandbox` (no API can make
real Dependabot open one on demand) and asserts the app's merge, skip, and
rebase behavior. The whole run is scripted in
`apps/dependabot-shepherd/e2e.sh`; this skill covers preconditions,
one-time sandbox setup, and failure triage.

## What it verifies

| Step | Scenario | Expected |
| --- | --- | --- |
| 1 | Patch PR (`Bump lodash from 4.17.20 to 4.17.21`) | approved and merged once the sandbox CI run is green |
| 2 | Major PR (`Bump react from 18.2.0 to 19.0.0`) | left open, zero reviews |
| 3 | Patch PR opened as draft, labeled `shepherd: ignore`, marked ready | left open, zero reviews |
| 4 | Patch PR carrying the `e2e-fail-marker` file (CI red) | blocked while red; merges after the marker is removed and CI turns green |
| 5 | Push to main that conflicts with the major PR's file | `@dependabot rebase` comment appears on it (a merely-stale PR reports `clean` without strict branch protection, so the scenario forces a conflict) |

## The author seam

The script's PRs are authored by the `gh` user, not `dependabot[bot]`, so it
starts the app server with `E2E_ALLOW_AUTHOR=<gh login>` — the one
deliberate test seam (see `apps/dependabot-shepherd/AGENTS.md`). If a server
is already listening on :3000 it is reused; that server must itself have
been started with `E2E_ALLOW_AUTHOR` set to the same login, or every
scenario times out with the app logging "not merging" skips. When in doubt,
stop the running server and let the script start its own.

## Preconditions

0. **A dev app registration.** The production app is hosted on Vercel
   (<https://dependabot-shepherd.bostonaholic.dev>) and its webhook URL
   points there — a local server on smee receives nothing from the
   production registration. And the hosted deployment can never run this
   e2e: it must not set `E2E_ALLOW_AUTHOR`. So the live e2e needs a
   separate dev app (`dependabot-shepherd-dev-bostonaholic`, registered via
   the empty-`.env` setup flow, installed only on the sandbox) whose
   webhook points at a smee channel, with its credentials in the local
   `.env`. Never repoint the production app's webhook at smee.
1. **`apps/dependabot-shepherd/.env`** — the (dev) app's credentials. If
   missing, the app has never been registered on this machine — stop and
   follow the Setup section of `apps/dependabot-shepherd/README.md` instead
   of guessing.
2. **`gh` authenticated** with push access to `bostonaholic/shepherd-sandbox`.
3. **App installed on the sandbox repo**
   (<https://github.com/settings/installations>).
4. **Sandbox prepared** (one-time, see below): the `e2e-ci` workflow exists
   on main. The script creates the `shepherd: ignore` label itself if
   missing. Keep the sandbox's auto-merge repo setting **off** and main
   unprotected — the e2e exercises the direct-merge fallback; the native
   auto-merge path (branch protection + required checks) is not covered.

## One-time sandbox setup

```bash
gh repo create bostonaholic/shepherd-sandbox --private --add-readme

cat > /tmp/e2e-ci.yml <<'YAML'
name: e2e-ci
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: test ! -f e2e-fail-marker
YAML

gh api -X PUT repos/bostonaholic/shepherd-sandbox/contents/.github/workflows/e2e-ci.yml \
  -f message="ci: e2e workflow" \
  -f content="$(base64 < /tmp/e2e-ci.yml)"
```

Then install the app on the sandbox repo, and set the sandbox repo's
watch status to **Ignore** (repo page → Watch → Ignore): e2e churn —
PRs, comments, and the deliberately failing `e2e-ci` runs — otherwise
emails whoever triggers it, and GitHub has no per-repo Actions
notification setting.

## Run

```bash
cd apps/dependabot-shepherd && npm run test:e2e
```

The script prints one `== step` header per scenario and ends with
`E2E PASS`. Merge waits poll for up to 240 s (`E2E_POLL_TIMEOUT`) because
Actions runner queueing dominates; negative assertions wait 20 s
(`E2E_GRACE`). The sandbox repo can be overridden with `E2E_REPO`. Expect a
full run to take several minutes — two scenarios each wait out a live
Actions run.

Cleanup closes the still-open PRs and deletes their branches on pass and
fail; merged PRs and the files they added stay in the sandbox history.

## Interpreting failures

- **Server startup failure**: the script prints the server log tail — a
  crash on boot points at the code or `.env`; a proxy-connect timeout
  points at smee.io or the network.
- **Timeout on step 1**: the app never merged. Check the server log tail:
  no webhook lines → delivery problem (smee channel, app not installed on
  the sandbox); "not merging —" skip lines show the policy reason;
  "enabling auto-merge failed" points at `classifyAutoMergeError` not
  recognizing a new GitHub error message. A reused server without
  `E2E_ALLOW_AUTHOR` produces silent author-guard skips (no log line).
- **Step 2/3 fail (PR touched)**: the policy let something through — a real
  regression in `src/policy.ts` or the label/draft handling.
- **Step 4 merged over red CI**: the checks rollup regressed
  (`checksRollup` in `src/shepherd.ts`) — this is the highest-severity
  failure the e2e can catch.
- **Step 5 timeout**: the rebase path regressed (`src/rebase.ts`), or
  `mergeable_state` stayed "unknown" past its retries — re-run once before
  diagnosing.
- Do not retry a failed run more than once before diagnosing: the run is
  deterministic apart from webhook and Actions delivery delays.
