---
name: create-github-app
description: Scaffold a new GitHub App in this monorepo from the checked-in template. Takes a description of the new app as its argument. Use when asked to "create a new app", "scaffold a new GitHub App", "add an app that <does X>".
argument-hint: "[description of the new app]"
---

# Create a new GitHub App from the template

Scaffolds one new app directory from this skill's bundled
`resources/template/`. The
copy and token fill are mechanical; `app.yml`, `README.md`, `AGENTS.md`,
and the `src/` design take judgment, driven by the description. One
argument:

- **description** — what the new app should do, in the user's words.
  Missing, or too vague to derive a name and behavior from → ask; never
  guess.

Scope ends at a verified, ready-to-commit scaffold. Registration,
hosting, icons, and e2e come later (Step 8).

## Hard constraints — read first

- Never modify `resources/template/` or another app's directory during
  a scaffold; every write lands under the new `apps/<app>/`.
- Never register, deploy, install, or repoint webhooks — out of scope.
- `npm install` needs network; offline → stop after Step 4 and say so.
- If verification fails, the scaffold is wrong — fix it; never skip or
  weaken tests to get past the gate.

## Step 1 — derive and confirm the name

Derive a kebab-case app name from the description. Rules:

- lowercase `a-z`, digits, and hyphens; starts with a letter; no
  leading/trailing/double hyphen
- **at most 21 characters** — the registered name `<app>-bostonaholic`
  must fit GitHub's 34-character app-name limit (`-bostonaholic` is 13)
- `test -d apps/<app>` at the repo root must fail; an existing directory of
  that name → stop and tell the user

Also derive the description phrase: a lowercase verb phrase completing
"a GitHub App that …" — no trailing period, no `"` or `\` (it lands
inside a JSON string).

**Present the name and the phrase to the user and wait for confirmation
before writing anything** — the name becomes a GitHub slug, a hostname,
and a tag prefix, so renaming later is painful.

## Step 2 — copy

From the repo root:

```bash
cp -R .claude/skills/create-github-app/resources/template/ apps/<app>/
rm -f apps/<app>/TEMPLATE.md   # -f: an `rm -i` alias would silently skip it
test ! -e apps/<app>/TEMPLATE.md && test -L apps/<app>/CLAUDE.md \
  && test -L apps/<app>/GEMINI.md && test -x apps/<app>/e2e.sh
```

The `test` line guards against a skipped TEMPLATE.md deletion and a
copy that dereferenced the `CLAUDE.md`/`GEMINI.md` symlinks or dropped
`e2e.sh`'s exec bit.

## Step 3 — mechanical fill

```bash
APP='<app>' DESC='<phrase>' find apps/<app> -type f -exec perl -pi -e \
  's/__APP_NAME__/$ENV{APP}/g; s/__APP_DESCRIPTION__/$ENV{DESC}/g' {} +
grep -rn '__APP_' apps/<app>/   # gate: must print nothing
```

perl `-pi` sidesteps the BSD/GNU `sed -i` split; passing the values via
the environment keeps any regex metacharacters in the phrase inert;
`-type f` skips the symlinks so `AGENTS.md` is rewritten once. A grep
hit means a file was missed or a token was mistyped — find it before
continuing.

## Step 4 — judgment fill

Clear every `TODO(scaffold)` marker; `grep -rn 'TODO(scaffold)' apps/<app>/`
must end up empty. From the description:

- **`app.yml`** — the minimum viable `default_events` and
  `default_permissions`, one justifying comment per permission (style:
  the other apps' `app.yml`).
- **`src/`** — pure core module(s) with real signatures, an
  orchestration module, and `index.ts` wiring that matches `app.yml`
  exactly. Wiring stays logic-free. Rename or extend `src/config.ts` as
  the design dictates. Relative imports use the `.js` extension.
- **`test/`** — one test file per src module (minus `index.ts`);
  hand-written structural fake octokits, no mocking framework.
- **`README.md`** — pitch and behavior sections; the Setup permissions
  list must mirror `app.yml` exactly.
- **`AGENTS.md`** — a bullet per src module and the app-specific
  behavioral invariants.

## Step 5 — verify

```bash
cd apps/<app> && npm install && npm run typecheck && npm test && npm run build
```

All green before proceeding (see Hard constraints).

## Step 6 — register in docs

Add the app's row (alphabetical) to the `## Apps` table in the root
`README.md`.

## Step 7 — propose the commit

`feat(<app>): scaffold`, covering `apps/<app>/` (including the generated
`package-lock.json`) and the root README row. Propose it; don't commit
without approval.

## Step 8 — report follow-ups

End by telling the user what was scaffolded and what intentionally
remains (don't attempt these):

- Register the app — Setup §1 of `apps/<app>/README.md` (Probot setup flow).
- Install it on repos — the `install-github-app` skill; add its
  `apps/<app>.md` resource — the file that sits next to
  `install-github-app`'s SKILL.md, not under the repo's top-level `apps/`
  — per that skill's "Adding a new app" section.
- Vercel project + DNS — `apps/<app>/README.md`, "Deploy".
- Icons — `apps/<app>/assets/`; then copy `icon.svg` → `public/favicon.svg`
  and generate `public/favicon.png` (`sips -Z 64 assets/icon.png --out
  public/favicon.png`) — the page already links both, and Vercel's
  dashboard takes its project icon from the deployed favicon.
- Real e2e — `e2e.sh`, a sandbox repo, and an `e2e-<app>` skill
  (models: the existing apps). Set the sandbox repo's watch status to
  **Ignore** (repo page → Watch → Ignore): e2e churn — PRs, comments,
  and any deliberately failing workflow runs — otherwise emails
  whoever triggers it, and GitHub has no per-repo Actions notification
  setting.
