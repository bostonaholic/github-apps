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
