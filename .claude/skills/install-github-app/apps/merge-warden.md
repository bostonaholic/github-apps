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

**Config file — usually none.** See `apps/merge-warden/README.md` for the
repo config file and its keys; only add one for non-default behavior.

**Required check (optional).** The app writes a `merge-warden` check run
on the head commit. Make it required only if the user wants merges blocked on it.

## Verify

- `GET https://merge-warden.bostonaholic.dev/api/github/webhooks` returns
  404 JSON (healthy function); 500 means bad credentials in the Vercel env.
- Open or push to a PR in the target repo and confirm the merge-warden
  check run appears.
