# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
