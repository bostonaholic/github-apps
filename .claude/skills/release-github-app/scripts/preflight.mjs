// Read-only check that an app is ready to release. Prints JSON with the
// current version, last release tag, commits since it, the [Unreleased]
// entries, and the argument to pass to prepare.mjs.
//
//   node .claude/skills/release-github-app/scripts/preflight.mjs <app>
//
// Exits 1 with a reason when the app cannot be released as-is.
import { readFileSync } from "node:fs";
import {
  findRelativeLinks,
  findSplitLists,
  hasSection,
  parseVersionFromTag,
  suggestBump,
  tagName,
  unreleasedBody,
} from "./release-lib.mjs";
import { appPaths, appTags, fail, readVersion, run } from "./repo.mjs";

const app = process.argv[2];
const { root, pkg, changelog, rel } = appPaths(app);

const dirty = run("git", ["status", "--porcelain"], { cwd: root });
if (dirty) fail(`working tree is not clean:\n${dirty}`);

const version = readVersion(pkg);
const text = readFileSync(changelog, "utf8");
let unreleased;
try {
  unreleased = unreleasedBody(text);
} catch (e) {
  fail(e.message);
}
if (!unreleased) fail(`${rel}/CHANGELOG.md [Unreleased] is empty: nothing to release`);

const relative = findRelativeLinks(unreleased);
if (relative.length) {
  fail(`[Unreleased] has relative links (release notes need absolute URLs): ${relative.join(", ")}`);
}

const split = findSplitLists(unreleased);
if (split.length) {
  fail(`[Unreleased] has a blank line between list items under: ${split.join(", ")}`);
}

const tags = appTags(root, app);
const lastTag = tags[0] ?? null;
const currentReleased = tags.includes(tagName(app, version)) || hasSection(text, version);
if (lastTag && parseVersionFromTag(lastTag) !== version && currentReleased) {
  fail(`package.json is ${version} but the newest tag is ${lastTag}`);
}

const range = lastTag ? [`${lastTag}..HEAD`] : ["HEAD"];
const commits = run("git", ["log", "--format=%h %s", ...range, "--", rel], { cwd: root })
  .split("\n")
  .filter(Boolean);

// First release: ship the version the app was scaffolded with.
const suggested = currentReleased ? suggestBump(unreleased) : version;

console.log(
  JSON.stringify(
    {
      app,
      branch: run("git", ["branch", "--show-current"], { cwd: root }),
      version,
      lastTag,
      currentReleased,
      commitsSinceLastTag: commits,
      unreleased,
      suggestedPrepareArg: suggested,
    },
    null,
    2,
  ),
);
