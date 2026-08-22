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

## Commits

Conventional Commits scoped by app name, e.g.
`feat(task-list-completed): ...`, `fix(task-list-completed): ...`.
