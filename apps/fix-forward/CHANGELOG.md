# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- When CI on the default branch goes red, re-run failed GitHub Actions
  jobs once, then open one `main-broken` issue per red streak naming the
  culprit pull request and quoting each failing step's log, and mention
  the configured coding agent once to fix it forward.
- Append new failures to the open streak issue, and close it with the
  fixing commit when the default branch turns green.
