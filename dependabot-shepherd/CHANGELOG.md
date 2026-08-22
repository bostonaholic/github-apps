# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
