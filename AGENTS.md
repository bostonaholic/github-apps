# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Gemini CLI, etc.) when working with code in this repository. `CLAUDE.md` and `GEMINI.md` are symlinks to this file.

## Repository layout

Monorepo of GitHub Apps. Each app lives in its own directory and is fully
self-contained: its own `package.json`, dependencies, README, and deployment.
Run all npm commands from inside the app's directory, not the repo root
(the root has no `package.json`). Shared code stays out of this repo until at
least two apps need it.

App specifics — commands, architecture, testing — live in each app's own
documentation (`<app>/README.md` and `<app>/AGENTS.md`). Read those before
working on an app.

New apps are scaffolded by the `create-github-app` skill from its
bundled template (`.claude/skills/create-github-app/resources/template/`).

## App registration names

GitHub App names are globally unique across all of GitHub (not namespaced
per owner), so plain names collide with other people's apps. Every app
registered from this repo takes the suffix `-bostonaholic`:

- **Registered name / slug:** `<app>-bostonaholic`, where `<app>` is the
  app's directory name — e.g. `task-list-completed-bostonaholic`,
  installable at `https://github.com/apps/<app>-bostonaholic`.
- The app's manifest (`<app>/app.yml`) declares the suffixed name, so
  registration produces it deterministically instead of GitHub prompting
  for a variant.
- The suffix applies only to the GitHub registration. Everything inside the
  repo — directory, commit scope, tags, changelog, status context — keeps
  the bare `<app>` name.

## Hosted deployments

Each app deploys to Vercel at `https://<app>.bostonaholic.dev`:

- **One Vercel project per app**, named `<app>`, in the **airship-labs**
  team (the account's only team — there is no `bostonaholic` Vercel team,
  and creating one would be a paid Pro plan). Root Directory is the app's
  directory; pushing to `main` deploys, with `vercel.json`'s
  `ignoreCommand` skipping builds for commits that don't touch the app.
- **Entry point** `api/github/webhooks/index.js` wraps the compiled app
  (`lib/index.js`) in Probot's `createNodeMiddleware`; `vercel.json`'s
  `buildCommand` runs `tsc` first. `public/index.html` must exist (Vercel's
  output-directory check) and is deliberately informative — don't strip it.
- **Project env vars:** `APP_ID`, `WEBHOOK_SECRET`, `PRIVATE_KEY`, and
  `NODEJS_HELPERS=0` (Vercel must not consume the request body — signature
  verification needs it raw). Never set `WEBHOOK_PROXY_URL` in production.
- **DNS:** Namecheap CNAME `<app>` → `cname.vercel-dns.com` on
  bostonaholic.dev.
- **Webhook URL:** the GitHub App registration points at
  `https://<app>.bostonaholic.dev/api/github/webhooks`. To inspect or
  repoint it (including rolling back to the smee channel kept as
  `WEBHOOK_PROXY_URL` in the app's `.env`):
  `node --env-file=<app>/.env scripts/repoint-webhook.mjs [--dry-run|<url>]`
  — or the app's settings page under <https://github.com/settings/apps>.

## Commits

Conventional Commits scoped by app name, e.g.
`feat(task-list-completed): ...`, `fix(task-list-completed): ...`.

## Changelogs

Each app keeps its own `CHANGELOG.md` in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Add an entry
under `[Unreleased]` for any user-visible change (`feat`, `fix`, behavior
changes); internal-only changes (`chore`, `test`, `refactor`, `docs`, `ci`)
get no entry. Only cut a versioned section when explicitly releasing.

## Tags and releases

Releases are per-app; the repo itself has no version. Tags are namespaced by
the app's directory name so apps never collide:

- **Tag format:** `<app>-v<X.Y.Z>`, e.g. `task-list-completed-v0.1.0`.
  `<app>` is the app's directory name; `<X.Y.Z>` is the app's `package.json`
  version. When parsing, the version is everything after the last `-v`.
  Bare `vX.Y.Z` tags are forbidden — ambiguous in a monorepo.
- **Release commit:** one commit on `main` that bumps `package.json` and
  renames the app changelog's `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`,
  with subject `chore(<app>): release vX.Y.Z`.
- **Signed annotated tags only**
  (`git tag -s <app>-vX.Y.Z -m "<app> vX.Y.Z"`), pointing at that release
  commit. The repo config sets `tag.gpgsign true`, so plain `git tag -a`
  signs too — but verify with `git tag -v` before pushing. Pushed release
  tags are immutable — never move, re-point, or delete one; fix mistakes
  with a new patch release.
- **One GitHub release per tag:** title `<app> vX.Y.Z`, body is that
  version's `CHANGELOG.md` section verbatim (this is why changelog links
  must be absolute URLs). Always pass `--latest=false` — GitHub's "Latest"
  badge is repo-global and meaningless when several apps release from one
  repo.
- **Listing an app's releases:**
  `git tag --list '<app>-v*' --sort=-version:refname`. An app's release
  baseline (e.g. for changelog work) is its most recent `<app>-v*` tag,
  never another app's tags.
