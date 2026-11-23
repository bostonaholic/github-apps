// Tags and publishes a merged release commit: signed tag, `git tag -v`,
// push, then one GitHub release whose body is the version's CHANGELOG.md
// section verbatim, never marked Latest.
//
//   node .claude/skills/release-github-app/scripts/publish.mjs <app> <X.Y.Z> <sha> [--dry-run]
//
// Refuses unless <sha> is on origin/main, is the release commit for that
// version, and neither the tag nor the release exists yet. Pushed tags are
// immutable — this script never moves or deletes one.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findRelativeLinks,
  isReleaseSubject,
  releaseTitle,
  sectionBody,
  tagMessage,
  tagName,
} from "./release-lib.mjs";
import { appPaths, fail, run, showAt, succeeds } from "./repo.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [app, version, ref] = args.filter((a) => a !== "--dry-run");
if (!ref) fail("usage: publish.mjs <app> <X.Y.Z> <sha> [--dry-run]");
const { root, rel } = appPaths(app);
const git = (...a) => run("git", a, { cwd: root });

const tag = tagName(app, version);
const title = releaseTitle(app, version);

git("fetch", "--quiet", "--tags", "origin", "main");
let sha;
try {
  sha = git("rev-parse", "--verify", `${ref}^{commit}`);
} catch {
  fail(`${ref} is not a commit`);
}
if (!succeeds("git", ["merge-base", "--is-ancestor", sha, "origin/main"], { cwd: root })) {
  fail(`${sha} is not on origin/main — merge the release PR first`);
}
const subject = git("log", "-1", "--format=%s", sha);
if (!isReleaseSubject(subject, app, version)) {
  fail(`${sha} is "${subject}", not the release commit for ${app} v${version}`);
}
const pkgVersion = JSON.parse(showAt(root, sha, `${rel}/package.json`)).version;
if (pkgVersion !== version) fail(`${rel}/package.json at ${sha} is ${pkgVersion}, not ${version}`);

if (succeeds("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`], { cwd: root })) {
  fail(`tag ${tag} already exists locally`);
}
if (git("ls-remote", "--tags", "origin", `refs/tags/${tag}`)) fail(`tag ${tag} already exists on origin`);
if (succeeds("gh", ["release", "view", tag], { cwd: root })) fail(`release ${tag} already exists`);

let notes;
try {
  notes = sectionBody(showAt(root, sha, `${rel}/CHANGELOG.md`), version);
} catch (e) {
  fail(e.message);
}
const relative = findRelativeLinks(notes);
if (relative.length) fail(`release notes have relative links: ${relative.join(", ")}`);
const notesFile = join(mkdtempSync(join(tmpdir(), "release-notes-")), "notes.md");
writeFileSync(notesFile, notes);

const steps = [
  ["git", ["tag", "-s", tag, "-m", tagMessage(app, version), sha]],
  ["git", ["tag", "-v", tag]], // exit status is the check; output is never grepped
  ["git", ["push", "origin", `refs/tags/${tag}`]],
  ["gh", ["release", "create", tag, "--verify-tag", "--title", title, "--latest=false", "--notes-file", notesFile]],
];

for (const [cmd, a] of steps) {
  console.log(`$ ${cmd} ${a.join(" ")}`);
  if (dryRun) continue;
  try {
    run(cmd, a, { cwd: root });
  } catch (e) {
    fail(`${cmd} ${a[0]} failed:\n${e.stderr || e.message}`);
  }
}

if (dryRun) {
  console.log(`\n--- release notes (${notesFile}) ---\n${notes}`);
} else {
  console.log(run("gh", ["release", "view", tag, "--json", "url", "-q", ".url"], { cwd: root }));
}
