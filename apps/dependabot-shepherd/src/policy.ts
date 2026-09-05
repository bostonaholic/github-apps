// Pure policy: configuration handling and the decision whether the app may
// merge a Dependabot PR. No I/O.

import type { Bump, Update } from "./parse.js";

export type Ceiling = "none" | "patch" | "minor" | "major";
export type MergeMethod = "squash" | "merge" | "rebase";

export interface ShepherdConfig {
  enabled: boolean;
  merge: Ceiling;
  security: Ceiling;
  merge_method: MergeMethod;
  rebase: boolean;
  packages: Record<string, Ceiling>;
}

export const DEFAULTS: ShepherdConfig = {
  enabled: true,
  merge: "minor",
  security: "minor",
  merge_method: "squash",
  rebase: true,
  packages: {},
};

// Per-PR opt-out.
export const IGNORE_LABEL = "shepherd: ignore";

const CEILINGS: Record<Ceiling, number> = { none: 0, patch: 1, minor: 2, major: 3 };
// "unknown" outranks every ceiling: never merged.
const BUMPS: Record<Bump, number> = { patch: 1, minor: 2, major: 3, unknown: 4 };

// Clamp a user-supplied config to safe values: invalid ceilings become
// "none" (don't merge) rather than silently widening, invalid merge
// methods fall back to squash.
export function normalizeConfig(raw: Record<string, unknown> | null): ShepherdConfig {
  const config = { ...DEFAULTS, ...(raw ?? {}) };
  const packages: Record<string, Ceiling> = {};
  if (typeof config.packages === "object" && config.packages !== null) {
    for (const [name, ceiling] of Object.entries(config.packages)) {
      packages[name] = isCeiling(ceiling) ? ceiling : "none";
    }
  }
  return {
    enabled: config.enabled !== false,
    merge: isCeiling(config.merge) ? config.merge : "none",
    security: isCeiling(config.security) ? config.security : "none",
    merge_method: isMergeMethod(config.merge_method) ? config.merge_method : "squash",
    rebase: config.rebase !== false,
    packages,
  };
}

function isCeiling(value: unknown): value is Ceiling {
  return typeof value === "string" && value in CEILINGS;
}

function isMergeMethod(value: unknown): value is MergeMethod {
  return value === "squash" || value === "merge" || value === "rebase";
}

// The ceiling for one package: exact override, then first matching
// trailing-* glob, then the global ceiling. Security PRs get whichever of
// that and the security ceiling is higher.
export function ceilingFor(
  name: string,
  config: ShepherdConfig,
  security: boolean,
): Ceiling {
  let ceiling = config.packages[name];
  if (ceiling === undefined) {
    for (const [pattern, value] of Object.entries(config.packages)) {
      if (pattern.endsWith("*") && name.startsWith(pattern.slice(0, -1))) {
        ceiling = value;
        break;
      }
    }
  }
  ceiling ??= config.merge;
  if (security && CEILINGS[config.security] > CEILINGS[ceiling]) {
    return config.security;
  }
  return ceiling;
}

export interface PrFacts {
  updates: Update[];
  security: boolean;
  draft: boolean;
  labels: string[];
  changesRequested: boolean;
}

export interface Decision {
  merge: boolean;
  reason: string;
}

export function decide(facts: PrFacts, config: ShepherdConfig): Decision {
  if (!config.enabled) return skip("disabled by repo config");
  if (facts.draft) return skip("draft PR");
  if (facts.labels.includes(IGNORE_LABEL)) return skip(`"${IGNORE_LABEL}" label`);
  if (facts.changesRequested) return skip("a reviewer requested changes");
  if (facts.updates.length === 0) return skip("could not parse the update");

  for (const update of facts.updates) {
    const ceiling = ceilingFor(update.name, config, facts.security);
    if (BUMPS[update.bump] > CEILINGS[ceiling]) {
      return skip(
        `${update.name} ${update.from} → ${update.to} is ${update.bump}, ceiling is ${ceiling}`,
      );
    }
  }

  const summary = facts.updates
    .map((u) => `${u.name} ${u.from} → ${u.to} (${u.bump})`)
    .join(", ");
  return { merge: true, reason: summary };
}

function skip(reason: string): Decision {
  return { merge: false, reason };
}

export interface ReviewFacts {
  userLogin: string | null;
  state: string;
  commitId: string | null;
}

// A PR counts as changes-requested while any reviewer's latest
// APPROVED/CHANGES_REQUESTED review (reviews arrive in chronological
// order) is CHANGES_REQUESTED. COMMENTED reviews don't supersede.
export function hasChangesRequested(reviews: ReviewFacts[]): boolean {
  const latest = new Map<string, string>();
  for (const review of reviews) {
    if (!review.userLogin) continue;
    if (review.state !== "APPROVED" && review.state !== "CHANGES_REQUESTED") continue;
    latest.set(review.userLogin, review.state);
  }
  return [...latest.values()].includes("CHANGES_REQUESTED");
}

// True when the current head commit already carries an approval — ours or
// anyone's — so re-approving would be noise.
export function isApprovedAtHead(reviews: ReviewFacts[], headSha: string): boolean {
  return reviews.some(
    (review) => review.state === "APPROVED" && review.commitId === headSha,
  );
}

export interface RebaseFacts {
  mergeableState: string;
  lastRebaseCommentAt: string | null;
  headCommittedAt: string | null;
}

// Ask Dependabot to rebase only when the PR is behind or conflicted and
// we haven't already asked since its head commit was pushed.
export function shouldRequestRebase(facts: RebaseFacts): boolean {
  if (facts.mergeableState !== "behind" && facts.mergeableState !== "dirty") {
    return false;
  }
  if (facts.lastRebaseCommentAt === null) return true;
  if (facts.headCommittedAt === null) return false;
  return facts.lastRebaseCommentAt < facts.headCommittedAt;
}
