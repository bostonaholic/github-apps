# dependabot-shepherd

- Registered slug: `dependabot-shepherd-bostonaholic`
- Hosted at: <https://dependabot-shepherd.bostonaholic.dev> — installing is
  all it takes for the repo's Dependabot PRs to start being shepherded.
- Installation id at the time of writing: `155737060`

## Validate

```bash
gh api repos/<owner>/<repo>/contents/.github/dependabot.yml --jq .path  # 404 → warn
gh api repos/<owner>/<repo>/contents/.github/workflows --jq length     # 404 → no-CI caveat
```

- Fork nuance: Dependabot does not run on forks.
- No `dependabot.yml` → warn that the app will sit idle except for
  security-update PRs, but proceed.
- **No-CI repos merge instantly**: on a repo with no workflow files and no
  commit statuses, an allowed update merges immediately after approval.
  Surface this and get the user's OK before installing on such a repo.

## Configure

**Config file — usually none.** Defaults: merge patch and minor, never
majors; squash merges; rebase comments on. Only add
`.github/dependabot-shepherd.yml` for non-default behavior — schema in the
Configuration section of `dependabot-shepherd/README.md`.

**No status check to require.** The app reports no commit status or check
run — it is an actor, not a gate. Leave branch protection exactly as it
is; the app defers to it via native auto-merge.

**Per-PR escape hatch.** A PR labeled `shepherd: ignore` is never touched.
Only if the user wants the label ready ahead of time:

```bash
gh label create "shepherd: ignore" --repo <owner>/<repo> \
  --description "dependabot-shepherd leaves this PR alone" --color ededed
```

## Verify

Live behavior cannot be exercised on demand — nothing can make Dependabot
open a PR now, and the live e2e (`e2e-dependabot-shepherd` skill) runs
only against a local dev app and the sandbox repo, never the production
app. The real check is the next Dependabot PR on the repo: the app
approves and merges it (or leaves it alone, per policy) — visible in the
PR timeline and the app's Recent Deliveries.
