// Writes the release commit's changes for one app: bumps package.json and
// package-lock.json, and cuts [Unreleased] into "## [X.Y.Z] - YYYY-MM-DD"
// (keeping an empty [Unreleased] above it). Does not commit — prints the
// commit subject to use.
//
//   node .claude/skills/release-github-app/scripts/prepare.mjs <app> <patch|minor|major|X.Y.Z>
import { readFileSync, writeFileSync } from "node:fs";
import {
  commitSubject,
  cutRelease,
  hasSection,
  resolveVersion,
  tagName,
} from "./release-lib.mjs";
import { appPaths, appTags, fail, readVersion, run, today } from "./repo.mjs";

const [app, arg] = process.argv.slice(2);
if (!arg) fail("usage: prepare.mjs <app> <patch|minor|major|X.Y.Z>");
const { root, dir, pkg, changelog, rel } = appPaths(app);
if (run("git", ["status", "--porcelain"], { cwd: root })) fail("working tree is not clean");

const current = readVersion(pkg);
const text = readFileSync(changelog, "utf8");
const currentReleased =
  appTags(root, app).includes(tagName(app, current)) || hasSection(text, current);

let version, updated;
try {
  version = resolveVersion(current, arg, { currentReleased });
  updated = cutRelease(text, version, today());
} catch (e) {
  fail(e.message);
}
if (appTags(root, app).includes(tagName(app, version))) {
  fail(`tag ${tagName(app, version)} already exists`);
}

if (version !== current) {
  run("npm", ["version", version, "--no-git-tag-version"], { cwd: dir });
}
writeFileSync(changelog, updated);

console.log(
  JSON.stringify(
    {
      app,
      from: current,
      version,
      files: run("git", ["status", "--porcelain", "--", rel], { cwd: root }).split("\n"),
      commitSubject: commitSubject(app, version),
    },
    null,
    2,
  ),
);
