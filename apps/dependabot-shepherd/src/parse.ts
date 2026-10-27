// Pure functions for extracting Dependabot update metadata from a PR's
// title, body, and branch. No I/O.

export type Bump = "patch" | "minor" | "major" | "unknown";

export interface Update {
  name: string;
  from: string;
  to: string;
  bump: Bump;
}

export const DEPENDABOT_LOGIN = "dependabot[bot]";

export function isDependabotBranch(ref: string): boolean {
  return ref.startsWith("dependabot/");
}

// Single-package titles, with or without a commit-message prefix like
// "chore(deps): ". The author guard runs before parsing, so matching
// anywhere in the title is safe and tolerant.
const BUMP_TITLE_RE = /\bbumps? (\S+) from (\S+) to (\S+)/i;
const REQUIREMENT_TITLE_RE = /\bupdates? (\S+) requirement from (.+?) to (.+?)(?: in \S+)?$/i;
// Grouped titles: "Bump the dev-dependencies group [across N directories]
// with N updates" — the per-package facts live in the body. The title
// does not list package names.
const GROUP_TITLE_RE = /\bbumps? the (.+?) group\b/i;
// "Bump a and b" / "Bump a, b and c", plus an optional directory suffix
// (" in /apps/foo" or " across 2 directories"). Names are in the title;
// versions are only in the body.
const MULTI_TITLE_RE =
  /\bbumps?\s+(.+?)(?:\s+in\s+\/\S*|\s+across\s+\d+\s+director(?:y|ies))?\s*$/i;
// One body line per package. Dependabot writes either a code span
// ("Updates `pkg` from a to b", optionally [`pkg`](url)) or, on some
// grouped PRs, a markdown link ("Updated [pkg](url) from a to b.").
const BODY_UPDATE_RE =
  /^Update[ds]? (?:\[?`([^`]+)`\]?(?:\([^)]*\))?|\[([^\]]+)\]\([^)]*\)) from (\S+) to (\S+)\s*$/gim;

const BUMP_RANK: Record<Bump, number> = { patch: 1, minor: 2, major: 3, unknown: 4 };

// Extract every update a Dependabot PR performs. Empty result means the
// title/body could not be parsed confidently — callers leave the PR alone.
export function parseUpdates(title: string, body: string | null | undefined): Update[] {
  const fromBody = parseBodyUpdates(body);

  // "Bump the X group ..." has no per-package versions in the title.
  if (GROUP_TITLE_RE.test(title)) return fromBody;

  const fromTitle = parseTitleUpdate(title);
  // A single from/to title is the whole update. Prefer it over body
  // lines so a release note cannot add a second package.
  if (fromTitle) return [fromTitle];

  // "Bump @vitest/mocker and vitest" names every package. A truncated
  // body that drops one Updates line must not merge the rest.
  const names = multiPackageNames(title);
  if (names) {
    const present = new Set(fromBody.map((update) => update.name));
    if (names.some((name) => !present.has(name))) return [];
    return fromBody;
  }

  return fromBody;
}

// Package names from "Bump a and b" or "Bump a, b and c". Null when the
// title is not that shape. Dependabot puts ", " between every name but
// the last, and " and " before the last.
function multiPackageNames(title: string): string[] | null {
  const match = title.match(MULTI_TITLE_RE);
  if (!match) return null;
  const list = match[1].trim();
  const parts = list.split(/\s+and\s+/i);
  if (parts.length !== 2) return null;
  const head = parts[0]
    .split(/\s*,\s*/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const last = parts[1].trim();
  if (last.length === 0 || last.includes(",") || head.length === 0) return null;
  if (head.some((name) => /\s/.test(name)) || /\s/.test(last)) return null;
  return [...head, last];
}

function parseTitleUpdate(title: string): Update | null {
  const single = title.match(BUMP_TITLE_RE) ?? title.match(REQUIREMENT_TITLE_RE);
  if (!single) return null;
  const [, name, from, to] = single;
  return { name, from, to, bump: bump(from, to) };
}

function parseBodyUpdates(body: string | null | undefined): Update[] {
  const updates: Update[] = [];
  const seen = new Set<string>();
  for (const match of (body ?? "").matchAll(BODY_UPDATE_RE)) {
    const name = match[1] ?? match[2];
    const from = trimVersion(match[3]);
    const to = trimVersion(match[4]);
    if (!name) continue;
    const key = `${name}\0${from}\0${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    updates.push({ name, from, to, bump: bump(from, to) });
  }
  return updates;
}

function trimVersion(version: string): string {
  return version.replace(/[.,;]+$/, "");
}

// The PR's update type. Unknown outranks major, so one unreadable
// version makes the whole PR unknown.
export function highestBump(updates: readonly Update[]): Bump | null {
  let highest: Bump | null = null;
  for (const update of updates) {
    if (highest === null || BUMP_RANK[update.bump] > BUMP_RANK[highest]) {
      highest = update.bump;
    }
  }
  return highest;
}

// Dependabot marks security PRs in the body it generates.
const SECURITY_RES = [
  /vulnerabilities? fixed/i,
  /security (?:update|fix|advisory)/i,
  /\bCVE-\d{4}-\d+\b/i,
  /\bGHSA(?:-[a-z0-9]{4}){3}\b/i,
];

export function isSecurityUpdate(body: string | null | undefined): boolean {
  if (!body) return false;
  return SECURITY_RES.some((re) => re.test(body));
}

// Tolerant version-bump math, not strict semver. Anything that cannot be
// compared with confidence (SHA pins, pre-releases, version ranges,
// identical versions) is "unknown", which policy never merges.
export function bump(from: string, to: string): Bump {
  const a = versionNumbers(from);
  const b = versionNumbers(to);
  if (!a || !b) return "unknown";
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      return i === 0 ? "major" : i === 1 ? "minor" : "patch";
    }
  }
  return "unknown";
}

function versionNumbers(version: string): number[] | null {
  const stripped = version
    .trim()
    .replace(/^[~^><=\s]+/, "")
    .replace(/^v/i, "")
    .replace(/[.,;]+$/, "");
  if (/^[0-9a-f]{40}$/i.test(stripped)) return null;
  if (stripped.includes("-") || stripped.includes("+")) return null;
  const parts = stripped.split(".");
  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    numbers.push(Number(part));
  }
  return numbers.length > 0 ? numbers : null;
}
