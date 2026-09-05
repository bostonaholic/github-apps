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
// with N updates" — the per-package facts live in the body.
const GROUP_TITLE_RE = /\bbumps? the (.+?) group\b/i;
// One body line per package in a grouped PR. The package name may be a
// plain `code span` or a [`code span`](link).
const GROUP_BODY_RE = /^Updates? \[?`([^`]+)`\]?(?:\([^)]*\))? from (\S+) to (\S+)/gim;

// Extract every update a Dependabot PR performs. Empty result means the
// title/body could not be parsed confidently — callers treat that like a
// major and leave the PR alone.
export function parseUpdates(title: string, body: string | null | undefined): Update[] {
  if (GROUP_TITLE_RE.test(title)) {
    const updates: Update[] = [];
    for (const match of (body ?? "").matchAll(GROUP_BODY_RE)) {
      const [, name, from, to] = match;
      updates.push({ name, from, to, bump: bump(from, to) });
    }
    return updates;
  }

  const single = title.match(BUMP_TITLE_RE);
  if (single) {
    const [, name, from, to] = single;
    return [{ name, from, to, bump: bump(from, to) }];
  }

  const requirement = title.match(REQUIREMENT_TITLE_RE);
  if (requirement) {
    const [, name, from, to] = requirement;
    return [{ name, from, to, bump: bump(from, to) }];
  }

  return [];
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
// identical versions) is "unknown", which policy treats like a major.
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
