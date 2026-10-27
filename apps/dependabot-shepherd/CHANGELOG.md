# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Multi-package Dependabot PRs are parsed and can merge. Titles like
  `Bump @vitest/mocker and vitest` and `Bump the X group ...` have no
  single from/to version, so the app logged "could not parse the update"
  and left them (for example
  <https://github.com/bostonaholic/github-apps/pull/34> and
  <https://github.com/bostonaholic/github-apps/pull/35>). Every
  `Updates \`pkg\` from a to b` line in the PR body is read. The PR's
  update type is the highest semver bump among those lines, and that
  bump still has to clear the configured ceiling.

## [0.2.0] - 2026-10-27

### Fixed

- Dependabot PRs are merged by the app once the head commit is green.
  Enabling GitHub auto-merge never landed them: org rulesets require
  `Cursor Security Agent: Security Reviewer`, that check does not run on
  Dependabot PRs, and auto-merge waits for it forever. The merge is pinned
  to the head SHA. Skipped checks count as green, and that Cursor check is
  ignored. Commit statuses are read past the first page, so a later red
  status is not missed when that check is in the list.

### Changed

- The default merge ceiling is major, so major updates merge along with
  patch and minor. Unparseable titles and unknown bumps are still left
  alone. A repo can set a lower ceiling in `.github/dependabot-shepherd.yml`.

## [0.1.1] - 2026-08-22

### Fixed

- The app icon no longer bakes in its own corner radius. GitHub rounds
  app avatars itself, so the old rounding showed notched corners and a
  mismatched curve; the icon art is now full-bleed like other app icons.

## [0.1.0] - 2026-08-22

### Changed

- The app is now hosted at <https://dependabot-shepherd.bostonaholic.dev>
  (Vercel). It acts on Dependabot PRs continuously — no local process needs
  to be running.

### Added

- Auto-merge for Dependabot PRs: the app approves an allowed update and
  enables GitHub's native auto-merge, falling back to a direct merge once
  checks are green on repos without branch protection. Default policy merges
  patch and minor updates; majors are never touched.
- Policy configuration via `.github/dependabot-shepherd.yml`: merge ceiling,
  separate ceiling for security updates, per-package overrides, merge
  method, and a repo-level disable.
- Automatic rebasing: a push to the default branch comments
  `@dependabot rebase` on open Dependabot PRs that fell behind or
  conflicted.
- Per-PR opt-out via the `shepherd: ignore` label.
