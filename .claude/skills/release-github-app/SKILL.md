---
name: release-github-app
description: Release one of this repo's GitHub Apps — version bump, changelog cut, release PR, signed tag, and GitHub release — with scripts that keep every app's release in the same shape. Takes the app and an optional bump. Use when asked to "release <app>", "cut a release of <app>", "ship a new version of <app>", or "tag <app>".
argument-hint: "[app] [patch|minor|major|X.Y.Z]"
---

# Release a GitHub App from this repo

The rules live in the root `AGENTS.md` ("Changelogs", "Tags and releases").
The scripts in `scripts/` implement every step with one correct answer;
`scripts/release-lib.mjs` is the single definition of the tag name, commit
subject, release title, changelog cut, and release notes. Never hand-write
any of those — run the script.

Arguments: **app** is a directory under `apps/`. **bump** is optional:
`patch`, `minor`, `major`, or an explicit `X.Y.Z`.
Several apps: an app needs a release when `git log <its latest tag>..origin/main
-- apps/<app>` is non-empty. Run one release per app, in parallel if wanted:
each PR touches only its app; rebase one that falls behind main.

Run every command from the repo (or worktree) root.

## Step 1 — preflight (read-only)

```bash
git fetch origin && git switch -c chore/<app>-release origin/main   # or reuse a worktree branch reset to origin/main
node .claude/skills/release-github-app/scripts/preflight.mjs <app>
```

Exits 1 with the reason if the tree is dirty, `[Unreleased]` is empty,
its links are relative, or a blank line splits a section's bullet list.
Otherwise prints JSON with `unreleased` entries and `suggestedPrepareArg`.

Choosing the bump is the one judgment call:

- The user's bump argument wins.
- Otherwise use `suggestedPrepareArg` (pre-1.0: `minor` when anything was
  added, changed, removed, or deprecated; `patch` for fixes/security only;
  the unchanged version for an app's first release).
- Never pick `major` yourself. If the entries describe a breaking change,
  ask the user.

Before Step 2, read every `[Unreleased]` entry against its heading:
Added (new), Changed (different behavior or default), Removed (gone),
Fixed (bug). Move a misfiled entry now; the notes are fixed once tagged.

## Step 2 — release commit

```bash
node .claude/skills/release-github-app/scripts/prepare.mjs <app> <bump>
```

Bumps `package.json` + `package-lock.json` (skipped on a first release) and
moves `[Unreleased]` under `## [X.Y.Z] - <today>`, leaving an empty
`[Unreleased]` above. Prints `commitSubject`. Commit exactly those files
with that subject as the first line, signed, and verify the signature:

```bash
git add apps/<app> && git commit -m "<commitSubject>"
git log -1 --show-signature
```

## Step 3 — release PR

1. `git push -u origin HEAD`, then `gh pr create --base main --title "<commitSubject>"`.
   Body: one paragraph naming the version and its headline entries, then
   "After merge: tag `<app>-vX.Y.Z` on the squash commit and a GitHub
   release (`--latest=false`)."
2. Wait for the `CI` check (never an `app (<app>)` check):
   `gh pr checks <n> --watch`. Red CI → stop and report.
3. `gh pr merge <n> --squash`. If merge-warden already merged it, skip.
4. Merge SHA: `gh pr view <n> --json mergeCommit -q .mergeCommit.oid`.

## Step 4 — tag and publish

```bash
node .claude/skills/release-github-app/scripts/publish.mjs <app> <X.Y.Z> <merge-sha> --dry-run   # review commands + notes
node .claude/skills/release-github-app/scripts/publish.mjs <app> <X.Y.Z> <merge-sha>
```

Refuses unless the SHA is on `origin/main`, its subject is the release
subject (squash `(#N)` suffix allowed), `package.json` there has the
version, and neither tag nor release exists. Then: `git tag -s`,
`git tag -v` (exit status), push the tag, `gh release create --verify-tag
--latest=false` with the changelog section as the body. Prints the release
URL — report it.

## Failure handling

- Any script exits 1 with `error: <reason>`: report location, cause, fix.
  Don't work around the check.
- Signing fails: stop, per the global signing rules. Never unsigned.
- Pushed tags are immutable. A wrong release after `git push` of the tag
  is fixed with a new patch release, never by moving or deleting the tag.
- Notes wrong, tag right: fix the section in a `docs(<app>)` PR, build the
  body with `sectionBody` (release-lib) from the merged CHANGELOG.md, and
  `gh release edit <tag> --notes-file <file>`. No patch release.
- A tag created locally but not pushed (e.g. `tag -v` failed): delete it
  with `git tag -d <tag>` and rerun `publish.mjs`.

## Tests

`node --test .claude/skills/release-github-app/scripts/release-lib.test.mjs` — unit tests for the shared module,
plus a check that every released section in every app's `CHANGELOG.md`
yields release notes with absolute links. Run after editing any script.
