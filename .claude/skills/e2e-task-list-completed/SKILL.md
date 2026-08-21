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

1. **App server running locally.** Check with `curl -s -o /dev/null http://localhost:3000 && echo up`.
   If down: run `npm start` in `task-list-completed/` **in the background** and
   confirm the log shows `Connected to https://smee.io/...`. This requires
   `task-list-completed/.env` to exist; if it does not, the app has never been
   registered — stop and follow the Setup section of
   `task-list-completed/README.md` instead of guessing.
2. **`gh` authenticated** with push access to `bostonaholic/task-list-sandbox`.
3. **App installed on the sandbox repo** (it is, unless someone uninstalled it —
   see <https://github.com/settings/installations>).

## Run

```bash
cd task-list-completed && npm run test:e2e
```

The script prints one `== step` header per row of the table, each satisfied
assertion, and ends with `E2E PASS`. It polls each expected status for up to
90 s (`E2E_POLL_TIMEOUT` to override); the sandbox repo can be overridden
with `E2E_REPO`.

Cleanup is automatic on pass **and** fail: the PR is closed and the branch
deleted. The closed PR stays in the sandbox history — the failure output
prints its URL for inspection.

## Interpreting failures

- **Timeout on step 1** (`last seen [none]`): webhooks are not reaching the
  app — server down, smee channel disconnected, or the app is not installed
  on the sandbox. Check the `npm start` terminal/log first; a healthy run
  logs a `POST /api/github/webhooks 200` per event.
- **Timeout on a later step**: the app received earlier events but computed
  the wrong result for this one — a real regression. The `last seen` value
  shows what the app actually reported; compare with the expected column
  above and look at the closed PR.
- **Sticky-comment assertion failures**: status math is right but the
  comment body/linking regressed — check `src/format.ts` and the sticky
  sync logic in `src/checklist.ts`.
- Do not retry a failed run more than once before diagnosing: the run is
  deterministic apart from webhook delivery delays.
