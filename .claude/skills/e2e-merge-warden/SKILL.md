---
name: e2e-merge-warden
description: Run the live end-to-end verification of the merge-warden GitHub App against the bostonaholic/merge-warden-sandbox repo. Use when asked to "run the e2e test", "verify the app end to end", "e2e merge-warden", or after changing the app when live verification is wanted.
---

# E2E verification: merge-warden

Opens real PRs in `bostonaholic/merge-warden-sandbox` and asserts the app's
`merge-warden` check run, its sticky grade comment, its approval, and its
merge for each scenario.
The whole run is scripted in `apps/merge-warden/e2e.sh`; this skill covers
preconditions, one-time sandbox setup, and failure triage.

## What it verifies

| Step | Scenario | Expected |
| --- | --- | --- |
| 1 | New `notes/*.md` file | check `success` "Eligible for auto-merge"; grade comment ✅ eligible, 🔄 Reversible, names the head commit; approved by the app's bot; merged once the sandbox `check` job is green |
| 2 | New `db/migrations/*.sql` file | check `neutral` "one-way door"; grade comment ⚠️ needs a person, ⛔ Irreversible; open, not approved |
| 3 | Notes file opened as draft, labeled `one-way-door`, marked ready | check `neutral` "label: one-way-door"; open, not approved |
| 4 | Notes file opened as draft, labeled `no-auto-merge`, marked ready | check `success` (the label does not change the grade); CI green; open, not approved |
| 5 | Notes file opened as draft with an `[e2e-fail-ci]` commit message (CI red), marked ready, then a second notes commit | check `success`; open and not approved while red; the fixing commit is graded `success`, the grade comment names it, and it is approved and merged |
| 6 | Notes file on a PR whose base is not `main` | out of scope: no `merge-warden` check run; open, not approved |

Every grade in steps 1–5 is a live Claude call (the model sees the diff).
Steps 1, 4, and 5 depend on the model grading a one-line notes file as low
risk with confidence ≥ 90.

## Modes

- **Hosted (`E2E_HOSTED=1`)**: asserts against the deployed app at
  <https://merge-warden.bostonaholic.dev> (`E2E_TARGET_URL` overrides),
  registration `merge-warden-bostonaholic`. Tests the **deployed** code,
  not the working tree. This is the normal mode after merging to `main`.
  The production app is installed on all `bostonaholic` repos, so the
  sandbox is covered without a separate install.
- **Local (default)**: builds the current source, starts the server, waits
  for the smee proxy to connect, and stops it on exit. A server already
  listening on :3000 is reused and left running (it may run stale code).
  Needs a dev app registration (`merge-warden-dev-bostonaholic`, via the
  empty-`.env` setup flow) installed only on the sandbox, with its webhook
  on a smee channel, and its credentials plus `ANTHROPIC_API_KEY` in
  `apps/merge-warden/.env`. Never repoint the production app's webhook at
  smee. With the production app also installed on the sandbox, both apps
  act on every PR; the script filters check runs and approvals by app slug
  (`E2E_APP_SLUG`, default `merge-warden-dev-bostonaholic` locally), but a
  merge by either app satisfies step 1. Exclude the sandbox from the
  production installation before trusting a local run.

## Preconditions

1. **`gh` authenticated as `bostonaholic`**, with push access to the
   sandbox. The sandbox config uses the default `authors` (the repo
   owner), so PRs opened by any other login are out of scope and every
   step times out.
2. **App installed on the sandbox repo**
   (<https://github.com/settings/installations>).
3. **Sandbox prepared** (one-time, see below): the `e2e-ci` workflow and
   `.github/merge-warden.yml` exist on main. The script creates the
   `one-way-door` and `no-auto-merge` labels itself if missing. Keep main
   unprotected — the e2e covers the direct-merge path, not native
   auto-merge (which needs branch protection requiring the
   `merge-warden` check pinned to the app).

## One-time sandbox setup

```bash
gh repo create bostonaholic/merge-warden-sandbox --private --add-readme

cat > /tmp/e2e-ci.yml <<'YAML'
name: e2e-ci
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - run: "! git log -1 --format=%B | grep -qF '[e2e-fail-ci]'"
YAML

gh api -X PUT repos/bostonaholic/merge-warden-sandbox/contents/.github/workflows/e2e-ci.yml \
  -f message="ci: e2e workflow" \
  -f content="$(base64 < /tmp/e2e-ci.yml)"

gh api -X PUT repos/bostonaholic/merge-warden-sandbox/contents/.github/merge-warden.yml \
  -f message="chore: merge-warden config" \
  -f content="$(printf 'merge_method: squash\nci_checks:\n  - check\n' | base64)"
```

The job fails when the head commit's message contains `[e2e-fail-ci]`.
The model sees only the diff, so step 5 grades the same plain notes file
as step 1: a fail-marker file in the diff dropped the model's confidence
under 90. Do not trigger red CI with a label either: each label event
starts a new workflow run in its own check suite, and `checksRollup`
counts the superseded failed run, so the PR stays red after a green
re-run. `ci_checks: [check]` names the
`e2e-ci` job; without it the app never
merges directly and steps 1 and 5 time out. Then set the sandbox repo's
watch status to **Ignore** (repo page → Watch → Ignore): e2e churn — PRs,
approvals, and the deliberately failing `e2e-ci` runs — otherwise emails
whoever triggers it.

## Run

```bash
cd apps/merge-warden && E2E_HOSTED=1 npm run test:e2e  # against production
cd apps/merge-warden && npm run test:e2e               # local server mode
```

The script prints one `== step` header per row of the table and ends with
`E2E PASS`. Waits poll for up to 240 s (`E2E_POLL_TIMEOUT`) because
Actions runner queueing dominates; negative assertions wait 20 s
(`E2E_GRACE`). The sandbox repo can be overridden with `E2E_REPO`. Expect
a full run to take 5–10 minutes and about seven model calls.

Cleanup closes the still-open PRs and deletes their branches (including
step 6's base branch) on pass and fail; merged PRs and the files they
added stay in the sandbox history.

## Interpreting failures

- **Hosted preflight failure** (`hosted app ... is not healthy`): the GET
  probe on the webhook path did not return 404 — the deployment, DNS, or
  TLS is down, or the function crashed on cold start (500: malformed
  `PRIVATE_KEY`/`APP_ID` in the Vercel env). Check the Vercel function
  logs.
- **Server startup failure**: the script prints the server log tail — a
  crash on boot points at the code or `.env`; a proxy-connect timeout
  points at smee.io or the network.
- **Step 1 check timeout, `last seen [none]`**: no check run from
  `$APP_SLUG` — webhooks are not arriving (app not installed, smee
  mismatch), the PR is out of scope (wrong `gh` login), or `E2E_APP_SLUG`
  names the wrong app.
- **Step 1/4/5 check `neutral` when `success` was expected**: read the
  check title. "confidence N% is below 90%" or "risk is medium" is the
  model, not a regression — re-run once. "could not grade" or "the model
  returned no assessment" is the API call failing (`ANTHROPIC_API_KEY`,
  quota, timeout). Anything else is a regression in `src/signals.ts`,
  `src/grade.ts`, or `src/policy.ts`.
- **Step 1/5 merge timeout after a `success` check**: the server log (or
  Vercel logs) says why — "waiting for ci_checks to succeed" means the
  rollup in `src/checks.ts` never went green or `ci_checks` does not name
  `check`; "merge failed" is a `pulls.merge` error other than 405/409.
- **Step 2 or 3 approved or merged**: a one-way door got through — the
  highest-severity failure the e2e can catch. Check `gradeVerdict` and
  `liveBlock` in `src/policy.ts` and the globs in `src/signals.ts`.
- **Grade comment timeout with a correct check**: the comment upsert
  failed (logged as "grade comment failed") or its body regressed —
  `commentBody` in `src/format.ts`, `upsertComment` in `src/gate.ts`. A
  failed comment never changes the verdict, so the check can pass while
  this fails.
- **Step 4 approved**: `liveBlock` stopped reading the `no-auto-merge`
  label, or the pre-verdict approval in `src/gate.ts` skipped
  `mergeDecision`.
- **Step 5 approved or merged while red**: `checksRollup` regressed.
- **Step 5 merge timeout after the fixing commit**: read the new head's
  check title (a model grade below 90 re-runs once), then the logs for
  "waiting for ci_checks to succeed" or "checks failing".
- **Step 6 got a check run**: `scopeBlock` stopped testing the base
  branch.
- Do not retry a failed run more than once before diagnosing: apart from
  webhook and Actions delays, the only nondeterminism is the model's
  grade, which the check title states.
