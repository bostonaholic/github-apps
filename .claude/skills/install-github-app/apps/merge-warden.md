# merge-warden

- Registered slug: `merge-warden-bostonaholic`
- Hosted at: <https://merge-warden.bostonaholic.dev>
- Installation id at the time of writing: `184791368` — installed with
  **All repositories** on `bostonaholic`, so every repo is already covered
  and Step 2's `--add` is not needed.

## Validate

- Fork nuance: PRs usually target upstream, where this installation does
  not apply.
- With required checks on the base branch, the app enables GitHub's
  native auto-merge; otherwise it merges directly (README, "Native
  auto-merge").

## Configure

**Config file — required to merge.** Add `.github/merge-warden.yml` on
the default branch with `ci_checks` naming the repo's CI check (the
check run's name as GitHub shows it, or a commit-status context). With
no `ci_checks` the app grades and approves but never merges directly,
and branches without a required `merge-warden` check use only the
direct path. Other keys: `apps/merge-warden/README.md`.

**Required check (optional).** The app writes a `merge-warden` check run
on the head commit. Make it required only if the user wants merges blocked on it.

## Verify

- `GET https://merge-warden.bostonaholic.dev/api/github/webhooks` returns
  404 JSON (healthy function); 500 means bad credentials in the Vercel env.
- Open or push to a PR in the target repo and confirm the merge-warden
  check run appears.
