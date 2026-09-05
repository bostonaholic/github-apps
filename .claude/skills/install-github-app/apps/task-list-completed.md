# task-list-completed

- Registered slug: `task-list-completed-bostonaholic`
- Hosted at: <https://task-list-completed.bostonaholic.dev> — statuses
  report continuously, so a *required* check is safe to add.
- Installation id at the time of writing: `155556892`

## Validate

- Fork nuance: PRs usually target upstream, where this installation does
  not apply.
- Keep the default branch name from Step 1 for the Configure section.

## Configure

**Config file — usually none.** Only add `.github/task-list.yml` in the
target repo for non-default behavior (`enabled: false` disables the app
repo-wide).

**Required status check.** The app reports a *commit status* (not a check
run) with context `task-list-completed`. Making it required is what
actually blocks merges. On the default branch:

- Existing classic protection — append without clobbering:

  ```bash
  gh api -X POST repos/<owner>/<repo>/branches/<branch>/protection/required_status_checks/contexts \
    -f "contexts[]=task-list-completed"
  ```

- No protection yet (`gh api .../protection` returns 404) — create minimal:

  ```bash
  gh api -X PUT repos/<owner>/<repo>/branches/<branch>/protection \
    --input - <<'EOF'
  {
    "required_status_checks": { "strict": false, "contexts": ["task-list-completed"] },
    "enforce_admins": false,
    "required_pull_request_reviews": null,
    "restrictions": null
  }
  EOF
  ```

- If the repo governs merges with **rulesets** instead
  (`gh api repos/<owner>/<repo>/rulesets` non-empty), add the context to
  the existing ruleset's "required status checks" rule rather than
  layering classic protection on top.

## Verify

- Required check: `gh api repos/<owner>/<repo>/branches/<branch>/protection/required_status_checks`
  lists `task-list-completed`.
- Live behavior (optional, with the user's OK — it opens and closes a real
  PR in the target repo): `cd apps/task-list-completed && E2E_REPO=<owner>/<repo> npm run test:e2e`
  — see the `e2e-task-list-completed` skill for preconditions and failure
  interpretation.
