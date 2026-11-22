# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- The grade comment ends with a footer naming the app version and the
  7-character commit SHA of the deployed build, e.g.
  `merge-warden v0.1.0 · cb6ab00`.

### Changed

- Grades with `claude-haiku-5-5` instead of `claude-sonnet-5-5`. The
  optional `ANTHROPIC_MODEL` environment variable selects another model
  without a code change.

### Fixed

- Approves without a review body, so the grade comment is the app's only
  comment on the pull request.
- No longer marks a change to an env template (`.env.example`,
  `.env.sample`, `.env.template`, `.env.dist`) as a one-way door. Real
  `.env` files still are.

## [0.1.0] - 2026-11-22

### Changed

- Posts the grade table, reasons, and findings as one comment on the pull
  request, edited on each new grade, instead of in the check run. The
  check run keeps the verdict and the reason.

### Added

- Grades each pull request that targets the default branch from
  deterministic path and diff-size rules, and reports the result as a
  `merge-warden` check run on the head commit. One-way doors (data
  changes, public contracts, security and access, or the `one-way-door`
  label) are named in the check.
- Sends the diff to Claude (`claude-sonnet-5-5`) for customer,
  data/security, and recovery risk, a one-way or two-way door
  classification, and a confidence. The check concludes `success` for a
  low-risk two-way door at 90% confidence or more, and `neutral`
  otherwise. The pull request's title and description are not sent.
- Approves and merges a pull request whose head commit has a `success`
  verdict, once every check named in the repo's `ci_checks` has succeeded
  and no other check is failing or running. A repo that names no
  `ci_checks` is never merged directly. The approval and the merge are pinned to the
  graded commit. The `one-way-door` and `no-auto-merge` labels, draft
  state, and requested changes are read on every event and stop the
  merge even after a `success` verdict. One-way doors are never merged.
- Enables GitHub's native auto-merge, pinned to the graded commit, on
  branches whose protection requires the `merge-warden` check from this
  app. Other branches keep the direct merge. The app disables auto-merge
  it enabled as soon as a pull request stops being eligible, and before
  it grades a new commit.
- App icon (`assets/icon.svg`, `assets/icon.png`) and the favicons the
  landing page links.
