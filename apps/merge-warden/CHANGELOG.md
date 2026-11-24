# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Comment `/merge-warden grade [model]` on a pull request to grade the
  head commit again with the default model or a named one (`haiku`,
  `sonnet`, `opus`, `fable`, or a full `claude-*` model ID). The newest
  grade is the verdict. Each model posts its own comment, and grading
  again with a model edits that model's comment. Requires write access
  on the repo; the app now asks for the Issues read permission and the
  `issue_comment` event.
- The grade comment footer names the model that graded the diff, e.g.
  `merge-warden vX.Y.Z · cb6ab00 · graded by claude-haiku-5-5`. A comment
  for a diff the model did not grade names no model.
- The app reacts 👀 to a `/merge-warden grade` comment as soon as it
  receives it, so the commenter sees the request arrived. The reaction
  is removed if the commenter lacks write access.
- `/merge-warden grade [model]` grades a pull request from a fork or by
  an author not in `authors` in grade-only mode: the app posts the grade
  comment and the check run, names who asked, and never approves or
  merges it. Opening or pushing to such a pull request still grades
  nothing.

### Changed

- A horizontal rule separates the grade comment from its build footer.

## [0.2.0] - 2026-11-22

### Added

- The grade comment ends with a footer naming the app version and the
  7-character commit SHA of the deployed build, e.g.
  `merge-warden v0.1.0 · cb6ab00`.

### Changed

- Claude judges every factor, including whether a change is a one-way
  door, from what the diff does, not from file names. The built-in path
  globs are gone: editing `.env.example`, a migration directory, or
  `auth/` no longer forces a one-way door on its own.
- Claude reports a change to CI workflows, CODEOWNERS, branch protection,
  or `.github/merge-warden.yml` as a high finding, replacing the built-in
  high-risk paths.
- Grades with `claude-haiku-5-5` instead of `claude-sonnet-5-5`. The
  optional `ANTHROPIC_MODEL` environment variable selects another model
  without a code change.

### Removed

- The medium risk floor for a diff over 400 changed lines or 20 files.
  Claude already lowers its confidence for a large change.
- The `one_way_door_paths` and `high_risk_paths` config keys. They are
  ignored if present. Use the `one-way-door` or `no-auto-merge` label on
  a pull request instead.

### Fixed

- Approves without a review body, so the grade comment is the app's only
  comment on the pull request.
- A failed check run no longer blocks the merge after a newer run of the
  same check succeeds. A workflow triggered by `opened`, `labeled` and
  `unlabeled` leaves three runs on one commit; the app now reads only the
  newest run of each check.

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
