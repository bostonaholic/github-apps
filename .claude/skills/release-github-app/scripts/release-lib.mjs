// The release structure every app in this repo shares: tag name, release
// title, commit subject, changelog shape, and release notes. Pure functions
// only — no git, no filesystem. The rules come from the root AGENTS.md
// ("Tags and releases", "Changelogs"); change them there and here together.

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const UNRELEASED_HEADING = "## [Unreleased]";

export const tagName = (app, version) => `${app}-v${version}`;
export const releaseTitle = (app, version) => `${app} v${version}`;
export const tagMessage = releaseTitle;
export const commitSubject = (app, version) =>
  `chore(${app}): release v${version}`;

// A squash merge appends " (#N)" to the subject.
export function isReleaseSubject(subject, app, version) {
  const expected = commitSubject(app, version);
  if (!subject.startsWith(expected)) return false;
  const suffix = subject.slice(expected.length);
  return suffix === "" || /^ \(#\d+\)$/.test(suffix);
}

// The version is everything after the last "-v".
export function parseVersionFromTag(tag) {
  const i = tag.lastIndexOf("-v");
  if (i < 0) throw new Error(`not an app tag: ${tag}`);
  return tag.slice(i + 2);
}

function parseVersion(version) {
  const m = VERSION_RE.exec(version);
  if (!m) throw new Error(`not an X.Y.Z version: ${version}`);
  return m.slice(1).map(Number);
}

export function compareVersions(a, b) {
  const [pa, pb] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export function bump(version, kind) {
  const [major, minor, patch] = parseVersion(version);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`bump kind must be patch, minor, or major: ${kind}`);
}

// Target version for a release. `arg` is patch|minor|major or an explicit
// X.Y.Z. An explicit version equal to the current one is allowed only when
// the current version was never released (an app's first release ships the
// version it was scaffolded with).
export function resolveVersion(current, arg, { currentReleased }) {
  if (["patch", "minor", "major"].includes(arg)) {
    if (!currentReleased) {
      throw new Error(
        `${current} was never released; release it as-is by passing ${current}`,
      );
    }
    return bump(current, arg);
  }
  const cmp = compareVersions(arg, current);
  if (cmp > 0) return arg;
  if (cmp === 0 && !currentReleased) return arg;
  throw new Error(`${arg} must be greater than the released ${current}`);
}

// Pre-1.0 convention used so far: anything that adds or changes behavior is
// a minor; fixes and security-only releases are a patch. Never suggests
// major — that is always a human call.
export function suggestBump(unreleased) {
  return /^### (Added|Changed|Removed|Deprecated)\b/m.test(unreleased)
    ? "minor"
    : "patch";
}

// Splits a changelog into [before, sectionText, after] for the section whose
// heading line starts with `heading`.
function splitSection(changelog, heading) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
  if (end < 0) end = lines.length;
  return [
    lines.slice(0, start).join("\n"),
    lines.slice(start, end).join("\n"),
    lines.slice(end).join("\n"),
  ];
}

const bodyOf = (section) => section.split("\n").slice(1).join("\n").trim();

export function unreleasedBody(changelog) {
  const parts = splitSection(changelog, UNRELEASED_HEADING);
  if (!parts) throw new Error(`changelog has no "${UNRELEASED_HEADING}" heading`);
  return bodyOf(parts[1]);
}

export const hasSection = (changelog, version) =>
  splitSection(changelog, `## [${version}]`) !== null;

// Moves the [Unreleased] entries under "## [version] - date" and leaves an
// empty [Unreleased] heading above it for the next change.
export function cutRelease(changelog, version, date) {
  parseVersion(version);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`bad date: ${date}`);
  if (hasSection(changelog, version)) {
    throw new Error(`changelog already has a [${version}] section`);
  }
  const body = unreleasedBody(changelog);
  if (!body) throw new Error("[Unreleased] is empty: nothing to release");
  const [before, , after] = splitSection(changelog, UNRELEASED_HEADING);
  const section = `${UNRELEASED_HEADING}\n\n## [${version}] - ${date}\n\n${body}\n`;
  return `${before}\n${section}${after ? `\n${after}` : ""}`;
}

// Release notes: the version's section verbatim, without its heading.
export function sectionBody(changelog, version) {
  const parts = splitSection(changelog, `## [${version}]`);
  if (!parts) throw new Error(`changelog has no [${version}] section`);
  const body = bodyOf(parts[1]);
  if (!body) throw new Error(`[${version}] section is empty`);
  return `${body}\n`;
}

// Release notes render outside the repo, so links must be absolute.
export function findRelativeLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)]
    .map((m) => m[1])
    .filter((url) => !/^(https?:|mailto:)/.test(url));
}

// A blank line between two bullets turns a tight list into a loose one and
// ships verbatim in the release notes. Returns the "### " heading of every
// section where a bullet follows a blank line that follows another bullet
// (or its indented continuation).
export function findSplitLists(markdown) {
  const offending = new Set();
  let heading = null;
  let inList = false;
  let blankBefore = false;
  for (const line of markdown.split("\n")) {
    if (line.trim() === "") {
      blankBefore = true;
      continue;
    }
    if (line.startsWith("### ")) {
      heading = line;
      inList = false;
    } else if (line.startsWith("- ")) {
      if (inList && blankBefore) offending.add(heading);
      inList = true;
    } else if (!/^\s/.test(line)) {
      inList = false;
    }
    blankBefore = false;
  }
  return [...offending];
}
