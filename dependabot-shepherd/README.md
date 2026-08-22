# dependabot-shepherd

A GitHub App that makes Dependabot pull requests zero-touch.

When Dependabot opens a PR, the app parses what's being updated and how big
the version jump is. If the update clears your policy (by default: patch and
minor updates, never majors), the app approves the PR and enables GitHub's
native auto-merge so it lands as soon as required checks pass. On repos
without branch protection, it merges directly once checks are green. And
whenever the default branch moves, the app asks Dependabot to rebase any of
its open PRs that fell behind.

Install it once on your account and every repo's dependency updates take
care of themselves — no per-repo workflow files.

## What gets merged

For each Dependabot PR the app extracts the package name(s) and version bump
from the PR title and body:

- `Bump lodash from 4.17.20 to 4.17.21` → patch
- `Bump react from 18.2.0 to 19.0.0` → major
- `Update rake requirement from ~> 13.0 to ~> 13.1` → minor
- `Bump the dev-dependencies group with 3 updates` → each update in the
  group is evaluated; all must clear the policy

The bump is compared against the policy ceiling. Anything the app cannot
parse confidently (SHA-pinned actions, pre-releases) is treated like a major:
left alone for a human. Security updates (PRs fixing a CVE/GHSA advisory)
get their own ceiling so you can fast-track them independently.

A PR is only ever touched when it is authored by `dependabot[bot]`, its
branch starts with `dependabot/`, it is not a draft, and no human has
requested changes.

## The merge

1. The app approves the PR (once per head commit — a rebase re-approves).
2. It enables **native auto-merge** with your configured merge method.
   GitHub then merges when all *required* checks pass — branch protection
   stays fully in charge.
3. If the repo can't use auto-merge (no branch protection requiring
   anything), the app checks the PR's check runs and commit statuses itself
   and merges directly when everything is green — or waits for the next
   check event if something is still running.

> **Note:** on a repo with *no CI at all* (no workflow files, no commit
> statuses), an allowed update merges immediately after approval.
> Zero-touch is the point — but know that this is the behavior before
> installing the app on such repos. On repos that *do* have workflow
> files, the app waits for checks to appear and finish before merging.

## Rebasing

On every push to the default branch, the app finds open Dependabot PRs that
are behind or conflicted and comments `@dependabot rebase` on them (at most
once per stale head). Dependabot force-pushes a fresh branch, checks re-run,
and the merge flow above picks the PR back up.

In practice this fires for conflicted PRs and, on repos with branch
protection requiring up-to-date branches, for behind ones. Without that
protection GitHub reports a merely-stale PR as `clean` — and it needs no
rebase to merge anyway.

## Configuration

Optional, via `.github/dependabot-shepherd.yml` in each repo (an org-wide
default can live in the org's `.github` repo). All fields optional:

```yaml
enabled: true          # false → the app does nothing on this repo
merge: minor           # auto-merge ceiling: none | patch | minor | major
security: minor        # ceiling for security-advisory PRs
merge_method: squash   # squash | merge | rebase
rebase: true           # false → never comment "@dependabot rebase"
packages:              # per-package ceilings (exact name or trailing-* glob)
  "eslint*": major
  "react": none
```

The effective ceiling for an update is the package override if one matches,
otherwise `merge`; for security updates, whichever of that and `security` is
higher.

To keep the app away from a single PR, add the `shepherd: ignore` label.

## Setup

### 1. Register the app

```bash
npm install
npm start
```

With no `APP_ID` configured, Probot serves its setup flow at
`http://localhost:3000` and registers the app from `app.yml` (defaults for
events and permissions). Save the generated credentials into `.env`
(see `.env.example`).

### 2. Install it

Install the app on your account and select the repositories where Dependabot
PRs should manage themselves.

### 3. Deploy

Run the server anywhere Node 20+ runs:

```bash
npm run build
npm start
```

For local development, set `WEBHOOK_PROXY_URL` to a [smee.io](https://smee.io)
channel so webhooks reach your machine.

## Development

```bash
npm test              # unit tests (vitest)
npm run typecheck     # tsc --noEmit
npm run test:e2e      # live e2e against a sandbox repo (see AGENTS.md)
```
