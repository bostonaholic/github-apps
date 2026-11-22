---
name: create-github-app
description: Scaffold a new GitHub App in this monorepo from the checked-in template. Takes a description of the new app as its argument. Use when asked to "create a new app", "scaffold a new GitHub App", "add an app that <does X>".
argument-hint: "[description of the new app]"
---

# Create a new GitHub App from the template

Scaffolds one new app directory from this skill's bundled
`resources/template/`, plus the app's `e2e-<app>` skill from
`resources/e2e-skill/`. The copy and token fill are mechanical;
`app.yml`, `README.md`, `AGENTS.md`, the `src/` design, the e2e
scenarios, and the icon drawing take judgment, driven by the
description. One argument:

- **description** — what the new app should do, in the user's words.
  Missing, or too vague to derive a name and behavior from → ask; never
  guess.

Scope ends at a verified, ready-to-commit scaffold. Registration,
hosting, and implementing `e2e.sh` come later (Step 9).

## Hard constraints — read first

- Never modify `resources/` or another app's directory or skill during
  a scaffold; every write lands under the new `apps/<app>/`, the new
  `.claude/skills/e2e-<app>/`, or the shared registration files (root
  `README.md` and `.github/dependabot.yml`, both Step 7).
- Never register, deploy, install, or repoint webhooks — out of scope.
- Icons (Step 5) need `rsvg-convert` (Homebrew `librsvg`) and `sips`;
  either missing → stop at Step 5 and say so. The scaffold is not
  finished without its icons.
- `npm install` needs network; offline → stop after Step 5 and say so.
- If verification fails, the scaffold is wrong — fix it; never skip or
  weaken tests to get past the gate.

## Step 1 — derive and confirm the name

Derive a kebab-case app name from the description. Rules:

- lowercase `a-z`, digits, and hyphens; starts with a letter; no
  leading/trailing/double hyphen
- **at most 21 characters** — the registered name `<app>-bostonaholic`
  must fit GitHub's 34-character app-name limit (`-bostonaholic` is 13)
- `test -d apps/<app>` and `test -d .claude/skills/e2e-<app>` at the repo
  root must both fail; an existing directory of either name → stop and
  tell the user

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

Then the e2e skill:

```bash
mkdir .claude/skills/e2e-<app>
cp .claude/skills/create-github-app/resources/e2e-skill/SKILL.md \
  .claude/skills/e2e-<app>/SKILL.md
```

## Step 3 — mechanical fill

```bash
APP='<app>' DESC='<phrase>' find apps/<app> .claude/skills/e2e-<app> \
  -type f -exec perl -pi -e \
  's/__APP_NAME__/$ENV{APP}/g; s/__APP_DESCRIPTION__/$ENV{DESC}/g' {} +
grep -rn '__APP_' apps/<app>/ .claude/skills/e2e-<app>/   # gate: must print nothing
```

perl `-pi` sidesteps the BSD/GNU `sed -i` split; passing the values via
the environment keeps any regex metacharacters in the phrase inert;
`-type f` skips the symlinks so `AGENTS.md` is rewritten once. A grep
hit means a file was missed or a token was mistyped — find it before
continuing.

## Step 4 — judgment fill

Clear every `TODO(scaffold)` marker;
`grep -rn 'TODO(scaffold)' apps/<app>/ .claude/skills/e2e-<app>/` must
end up empty, except the one in `apps/<app>/e2e.sh` (the stub stays
until Step 9's follow-up implements it). From the description:

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
- **`.claude/skills/e2e-<app>/SKILL.md`** — the planned scenario table
  (it is the spec `e2e.sh` is later written to), any sandbox fixtures,
  and per-scenario failure bullets naming the `src/` module at fault.
  Models: the existing `e2e-*` skills. Keep the **Status** paragraph —
  `e2e.sh` is still a stub.

## Step 5 — icons

Four files, all required: `assets/icon.svg`, `assets/icon.png` (the
logo uploaded when the app is registered), and
`public/favicon.{svg,png}` (`public/index.html` links both, and Vercel's
dashboard takes its project icon from the deployed favicon). The drawing
takes judgment; the three files derived from it are mechanical.

From the repo root:

```bash
command -v rsvg-convert && command -v sips   # gate: must print two paths
mkdir -p apps/<app>/assets
```

Fewer than two paths → stop (see Hard constraints).

Write `apps/<app>/assets/icon.svg` by hand from this skeleton. Replace
the four `<…>` placeholders; change nothing else:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <!-- Background: dark GitHub-toned square, full-bleed — GitHub rounds avatars itself -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1c2431"/>
      <stop offset="1" stop-color="#0d1117"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="<accent-light>"/>
      <stop offset="1" stop-color="<accent-dark>"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>

  <motif>

  <!-- Badge, bottom-right -->
  <circle cx="768" cy="736" r="180" fill="#0d1117"/>
  <circle cx="768" cy="736" r="148" fill="url(#accent)"/>
  <glyph>
</svg>
```

- **`<accent-light>`, `<accent-dark>`** — the app's accent color, lighter
  stop first; a pair no other app uses
  (`grep -h stop-color apps/*/assets/icon.svg` lists the colors taken).
- **`<motif>`** — shapes that depict what the app does, from the
  description. The badge's `r="180"` circle covers anything under it.
- **`<glyph>`** — a white (`#ffffff`) symbol of the app's outcome, inside
  the `r="148"` circle.
- One comment per shape or group. No `<image>`, `<text>`, or `href`: no
  embedded raster, no fonts, no external references.
- Models: the existing apps' `assets/icon.svg`.

Derive the other three files:

```bash
(cd apps/<app> \
  && rsvg-convert -w 1024 -h 1024 assets/icon.svg -o assets/icon.png \
  && cp assets/icon.svg public/favicon.svg \
  && sips -Z 64 assets/icon.png --out public/favicon.png)
```

Gate — one chain; `set -x` traces each check, so when `icons-ok` is
missing, the last traced command is the check that failed:

```bash
(cd apps/<app> && set -x \
  && test -s assets/icon.svg && test -s assets/icon.png \
  && test -s public/favicon.svg && test -s public/favicon.png \
  && ! grep -nE '<image|<text|href=' assets/icon.svg \
  && grep -qF 'width="1024" height="1024" viewBox="0 0 1024 1024"' assets/icon.svg \
  && grep -qF '<stop offset="0" stop-color="#1c2431"/>' assets/icon.svg \
  && grep -qF '<stop offset="1" stop-color="#0d1117"/>' assets/icon.svg \
  && grep -qF '<rect width="1024" height="1024" fill="url(#bg)"/>' assets/icon.svg \
  && grep -qF '<circle cx="768" cy="736" r="180" fill="#0d1117"/>' assets/icon.svg \
  && grep -qF '<circle cx="768" cy="736" r="148" fill="url(#' assets/icon.svg \
  && cmp assets/icon.svg public/favicon.svg \
  && file assets/icon.png | grep -q 'PNG image data, 1024 x 1024,' \
  && file public/favicon.png | grep -q 'PNG image data, 64 x 64,' \
  && echo icons-ok)   # gate: must print icons-ok
```

Then view `apps/<app>/assets/icon.png` and
`apps/<app>/public/favicon.png` as images. A blank or broken render
passes the gate, so confirm in the images:

- the background fills the square edge to edge
- the motif is whole, not clipped, and shows what the app does
- the badge sits bottom-right with its white glyph inside the circle
- at 64×64 the motif and the badge are still distinct

Any miss → fix `icon.svg`, then re-run the derive block and the gate.
Can't view images → stop and say so.

## Step 6 — verify

```bash
cd apps/<app> && npm install && npm run typecheck && npm test && npm run build
```

All green before proceeding (see Hard constraints).

## Step 7 — register in docs and Dependabot

- Add the app's row (alphabetical) to the `## Apps` table in the root
  `README.md`.
- Add an `npm` entry for `/apps/<app>` to `.github/dependabot.yml`,
  copying an existing entry and swapping the directory and
  `chore(<app>)` commit scope. The root is not a package, so there is no
  `/` entry; the template under `.claude/` is deliberately not scanned.

## Step 8 — propose the commit

`feat(<app>): scaffold`, covering `apps/<app>/` (including the generated
`package-lock.json` and the four icon files), `.claude/skills/e2e-<app>/`,
the root README row, and the `.github/dependabot.yml` entry. Propose it; don't commit without
approval.

## Step 9 — report follow-ups

End by telling the user what was scaffolded and what intentionally
remains (don't attempt these):

- Register the app — Setup §1 of `apps/<app>/README.md` (Probot setup flow).
- Install it on repos — the `install-github-app` skill; add its
  `apps/<app>.md` resource — the file that sits next to
  `install-github-app`'s SKILL.md, not under the repo's top-level `apps/`
  — per that skill's "Adding a new app" section.
- Vercel project + DNS — `apps/<app>/README.md`, "Deploy".
- Real e2e — implement `apps/<app>/e2e.sh` to the scenario table in
  `.claude/skills/e2e-<app>/SKILL.md` (models: the existing apps), do
  that skill's one-time sandbox setup (including watch status
  **Ignore**), then delete its **Status** paragraph and correct any row
  the implementation changed.
