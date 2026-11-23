// Run: node --test .claude/skills/release-github-app/scripts/release-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  tagName,
  releaseTitle,
  commitSubject,
  isReleaseSubject,
  parseVersionFromTag,
  bump,
  resolveVersion,
  suggestBump,
  unreleasedBody,
  cutRelease,
  sectionBody,
  findRelativeLinks,
  findSplitLists,
} from "./release-lib.mjs";

const HEADER = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
`;

const withUnreleased = `${HEADER}
## [Unreleased]

### Fixed

- Dependabot PRs are merged by the app once the head commit is green.

## [0.1.0] - 2026-08-22

### Added

- Policy configuration via \`.github/dependabot-shepherd.yml\`.
`;

test("names follow the AGENTS.md formats", () => {
  assert.equal(tagName("merge-warden", "0.1.0"), "merge-warden-v0.1.0");
  assert.equal(releaseTitle("merge-warden", "0.1.0"), "merge-warden v0.1.0");
  assert.equal(
    commitSubject("merge-warden", "0.1.0"),
    "chore(merge-warden): release v0.1.0",
  );
});

test("isReleaseSubject accepts the squash-merge suffix only", () => {
  const s = "chore(merge-warden): release v0.1.0";
  assert.ok(isReleaseSubject(s, "merge-warden", "0.1.0"));
  assert.ok(isReleaseSubject(`${s} (#59)`, "merge-warden", "0.1.0"));
  assert.ok(!isReleaseSubject(`${s}1 (#59)`, "merge-warden", "0.1.0"));
  assert.ok(!isReleaseSubject(`${s} extra`, "merge-warden", "0.1.0"));
  assert.ok(!isReleaseSubject(s, "merge-warden", "0.1.1"));
});

test("parseVersionFromTag takes everything after the last -v", () => {
  assert.equal(parseVersionFromTag("task-list-completed-v0.2.0"), "0.2.0");
  assert.throws(() => parseVersionFromTag("v0.2.0x"), /not an app tag/);
});

test("bump", () => {
  assert.equal(bump("0.1.1", "patch"), "0.1.2");
  assert.equal(bump("0.1.1", "minor"), "0.2.0");
  assert.equal(bump("0.1.1", "major"), "1.0.0");
  assert.throws(() => bump("0.1", "patch"), /X\.Y\.Z/);
  assert.throws(() => bump("0.1.0", "huge"), /bump kind/);
});

test("resolveVersion", () => {
  const released = { currentReleased: true };
  const unreleased = { currentReleased: false };
  assert.equal(resolveVersion("0.1.0", "minor", released), "0.2.0");
  assert.equal(resolveVersion("0.1.0", "0.3.0", released), "0.3.0");
  assert.equal(resolveVersion("0.1.0", "0.1.0", unreleased), "0.1.0");
  assert.throws(() => resolveVersion("0.1.0", "0.1.0", released), /greater/);
  assert.throws(() => resolveVersion("0.2.0", "0.1.9", released), /greater/);
  assert.throws(() => resolveVersion("0.1.0", "patch", unreleased), /never released/);
});

test("suggestBump: behavior changes are minor, fixes are patch", () => {
  assert.equal(suggestBump("### Fixed\n\n- x"), "patch");
  assert.equal(suggestBump("### Security\n\n- x"), "patch");
  assert.equal(suggestBump("### Fixed\n\n- x\n\n### Changed\n\n- y"), "minor");
  assert.equal(suggestBump("### Added\n\n- x"), "minor");
});

test("unreleasedBody", () => {
  assert.equal(
    unreleasedBody(withUnreleased),
    "### Fixed\n\n- Dependabot PRs are merged by the app once the head commit is green.",
  );
  assert.equal(unreleasedBody(`${HEADER}\n## [Unreleased]\n`), "");
  assert.throws(() => unreleasedBody(HEADER), /no "## \[Unreleased\]"/);
});

test("cutRelease keeps an empty [Unreleased] above the new section", () => {
  const out = cutRelease(withUnreleased, "0.1.1", "2026-11-22");
  assert.equal(
    out,
    `${HEADER}
## [Unreleased]

## [0.1.1] - 2026-11-22

### Fixed

- Dependabot PRs are merged by the app once the head commit is green.

## [0.1.0] - 2026-08-22

### Added

- Policy configuration via \`.github/dependabot-shepherd.yml\`.
`,
  );
  assert.equal(unreleasedBody(out), "");
});

test("cutRelease of a first release with no older sections", () => {
  const first = `${HEADER}\n## [Unreleased]\n\n### Added\n\n- Grades PRs.\n`;
  assert.equal(
    cutRelease(first, "0.1.0", "2026-11-22"),
    `${HEADER}\n## [Unreleased]\n\n## [0.1.0] - 2026-11-22\n\n### Added\n\n- Grades PRs.\n`,
  );
});

test("cutRelease refuses empty [Unreleased], an existing section, bad input", () => {
  const empty = `${HEADER}\n## [Unreleased]\n\n## [0.1.0] - 2026-08-22\n\n- x\n`;
  assert.throws(() => cutRelease(empty, "0.1.1", "2026-11-22"), /nothing to release/);
  assert.throws(() => cutRelease(withUnreleased, "0.1.0", "2026-11-22"), /already has/);
  assert.throws(() => cutRelease(withUnreleased, "0.1", "2026-11-22"), /X\.Y\.Z/);
  assert.throws(() => cutRelease(withUnreleased, "0.1.1", "11/22/2026"), /bad date/);
});

test("sectionBody returns the section without its heading", () => {
  assert.equal(
    sectionBody(withUnreleased, "0.1.0"),
    "### Added\n\n- Policy configuration via `.github/dependabot-shepherd.yml`.\n",
  );
  assert.throws(() => sectionBody(withUnreleased, "0.9.0"), /no \[0\.9\.0\]/);
});

test("findRelativeLinks", () => {
  assert.deepEqual(
    findRelativeLinks(
      "[a](https://x.dev) [b](README.md) [c](./docs/x.md \"t\") <https://y.dev>",
    ),
    ["README.md", "./docs/x.md"],
  );
});

// Every released section in the real changelogs must produce valid notes.
test("every app's released changelog sections produce release notes", () => {
  const apps = join(import.meta.dirname, "../../../../apps");
  for (const app of readdirSync(apps)) {
    const path = join(apps, app, "CHANGELOG.md");
    if (!existsSync(path)) continue;
    const changelog = readFileSync(path, "utf8");
    unreleasedBody(changelog);
    for (const [, version] of changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)) {
      const notes = sectionBody(changelog, version);
      assert.deepEqual(findRelativeLinks(notes), [], `${app} ${version}`);
    }
  }
});

test("findSplitLists flags a blank line between bullets of one section", () => {
  const split = [
    "### Fixed",
    "",
    "- Approves without a review body.",
    "",
    "- A failed check run no longer blocks the merge after a newer",
    "  run of the same check succeeds.",
    "",
    "### Changed",
    "",
    "- One.",
    "  Continued.",
    "",
    "- Two.",
  ].join("\n");
  assert.deepEqual(findSplitLists(split), ["### Fixed", "### Changed"]);
});

test("findSplitLists accepts tight lists and bullets after a paragraph", () => {
  const ok = [
    "### Fixed",
    "",
    "- One.",
    "  Continued.",
    "- Two.",
    "",
    "### Changed",
    "",
    "Intro paragraph.",
    "",
    "- Three.",
  ].join("\n");
  assert.deepEqual(findSplitLists(ok), []);
});
