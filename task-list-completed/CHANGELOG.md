# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- The app is now hosted at <https://task-list-completed.bostonaholic.dev>
  (Vercel). Statuses report continuously — no local process needs to be
  running, so a required `task-list-completed` check is always safe to add.

## [0.1.0] - 2026-08-22

### Added

- Merge gate for markdown task lists. The app reports a `task-list-completed`
  commit status on the PR's head commit: red while any task is unchecked,
  green when all are done. Pair it with a branch protection rule to block
  merges until every box is ticked.
- Tasks are counted from all four PR text sources: the description, comments,
  reviews, and review comments. Checkboxes inside fenced code blocks are
  ignored.
- A single sticky comment on the PR lists the outstanding tasks, each linked
  back to where it was written.
- The gate can be switched off at three levels: repo config
  (`.github/task-list.yml`), PR marker or label, and a per-comment ignore
  marker. Disabled always reports a green status, so a required check never
  wedges a PR.
