---
name: e2e-task-list-completed
description: Run the live end-to-end verification of the task-list-completed GitHub App against the bostonaholic/task-list-sandbox repo. Use when asked to "run the e2e test", "verify the app end to end", "e2e task-list-completed", or after changing the app when live verification is wanted.
---

# E2E verification: task-list-completed

Drives a real PR in `bostonaholic/task-list-sandbox` through the full task
list lifecycle and asserts the `task-list-completed` commit status and the
bot's sticky comment after each mutation. The whole run is scripted in
`task-list-completed/e2e.sh`; this skill is about getting the preconditions
right and interpreting failures.

## What it verifies

| Step | Mutation | Expected status |
| --- | --- | --- |
| 1 | PR opened, description has `- [ ]` + `- [x]` | 🔴 `1 of 2 tasks remaining`; sticky comment links the item; status `target_url` points at the sticky comment |
| 2 | Comment added with an unchecked task | 🔴 `2 of 3 tasks remaining` |
| 3 | Description box checked | 🔴 `1 of 3 tasks remaining` |
| 4 | Comment marked `<!-- task-list: ignore -->` | 🟢 `All 2 tasks complete`; sticky flips to ✅ |
| 5 | Review submitted with an unchecked task | 🔴 `1 of 3 tasks remaining`; sticky links `#pullrequestreview-…` |
| 6 | Review box checked | 🟢 `All 3 tasks complete` |

## Preconditions

Two modes:

- **Local (default)**: the script manages the app server itself: it builds
  the current source, starts the server, waits for the webhook proxy to
  connect, and stops it on exit. If a server is already listening on :3000
  it is reused and left running — note that a reused server may be running
  stale code, so restart it (or stop it and let the script start one) when
  testing fresh changes. Requires the production app registration's webhook
  URL to point at the smee channel — since the app is hosted, that means a
  dev app registration (see the README's Development section).
- **Hosted (`E2E_HOSTED=1`)**: no server lifecycle at all — asserts against
  the deployed app at <https://task-list-completed.bostonaholic.dev>
  (`E2E_TARGET_URL` overrides). Tests the **deployed** code, not the working
  tree. This is the normal mode after merging to `main`.

What must exist beforehand:

1. **`task-list-completed/.env`** — the app's credentials. If missing, the
   app has never been registered on this machine — stop and follow the Setup
   section of `task-list-completed/README.md` instead of guessing.
2. **`gh` authenticated** with push access to `bostonaholic/task-list-sandbox`.
3. **App installed on the sandbox repo** (it is, unless someone uninstalled it —
   see <https://github.com/settings/installations>).

## Run

```bash
cd task-list-completed && E2E_HOSTED=1 npm run test:e2e  # against production
cd task-list-completed && npm run test:e2e               # local server mode
```

The script prints one `== step` header per row of the table, each satisfied
assertion, and ends with `E2E PASS`. It polls each expected status for up to
90 s (`E2E_POLL_TIMEOUT` to override); the sandbox repo can be overridden
with `E2E_REPO`.

Cleanup is automatic on pass **and** fail: the PR is closed and the branch
deleted. The closed PR stays in the sandbox history — the failure output
prints its URL for inspection.

## Interpreting failures

- **Hosted preflight failure** (`hosted app ... is not healthy`): the GET
  probe on the webhook path did not return 404 — the deployment, DNS, or
  TLS is down (000/timeouts), or the function crashed on cold start (500:
  malformed `PRIVATE_KEY`/`APP_ID` in the Vercel env). Check the Vercel
  dashboard's function logs before rerunning.
- **Server startup failure**: the script prints the server log tail — a
  crash on boot points at the code or `.env`; a proxy-connect timeout points
  at smee.io or the network.
- **Timeout on step 1** (`last seen [none]`): the server is up but webhooks
  are not reaching it — smee channel mismatch, or the app is not installed
  on the sandbox. On failure the script prints its server log tail (a
  healthy run logs a `POST /api/github/webhooks 200` per event); for a
  reused server, check that server's own terminal instead.
- **Timeout on a later step**: the app received earlier events but computed
  the wrong result for this one — a real regression. The `last seen` value
  shows what the app actually reported; compare with the expected column
  above and look at the closed PR.
- **Sticky-comment assertion failures**: status math is right but the
  comment body/linking regressed — check `src/format.ts` and the sticky
  sync logic in `src/checklist.ts`.
- Do not retry a failed run more than once before diagnosing: the run is
  deterministic apart from webhook delivery delays.
