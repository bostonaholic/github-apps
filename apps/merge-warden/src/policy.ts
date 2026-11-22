// Pure policy: whether a pull request is in scope, whether a grade makes
// its commit eligible for auto-merge, and whether the app may merge right
// now. No I/O.
//
// Two tests run at different times. gradeVerdict runs once per commit and
// its result is stored as the check run's conclusion. liveBlock runs on
// every event against facts read fresh from GitHub, so a label added
// after a commit was graded still stops the merge.

import {
  NO_AUTO_MERGE_LABEL,
  ONE_WAY_DOOR_LABEL,
  type WardenConfig,
} from "./config.js";
import type { Grade } from "./grade.js";
import { exceeds, type Level } from "./signals.js";

// The highest risk and the lowest confidence that may auto-merge.
// Constants, not config: a repo cannot loosen them.
export const MAX_RISK: Level = "low";
export const MIN_CONFIDENCE = 90;

export interface Verdict {
  eligible: boolean;
  reason: string;
}

export interface ScopeFacts {
  authorLogin: string | null;
  headRepo: string | null;
  baseRepo: string;
  baseRef: string;
  defaultBranch: string;
}

// Why the app must leave this pull request alone entirely, or null when
// it is in scope. Out-of-scope pull requests are not graded.
export function scopeBlock(
  facts: ScopeFacts,
  config: Pick<WardenConfig, "authors">,
): string | null {
  const author = facts.authorLogin?.toLowerCase() ?? "";
  if (!config.authors.includes(author)) return "author is not in the allowlist";
  // A deleted fork has no head repo. It is still a fork.
  if (facts.headRepo !== facts.baseRepo) return "head branch is in a fork";
  if (facts.baseRef !== facts.defaultBranch) return "base is not the default branch";
  return null;
}

// What the check run concludes for a graded commit. The one-way-door
// test comes first and reads nothing else: no other field of the grade
// can make a one-way door eligible.
export function gradeVerdict(grade: Grade): Verdict {
  if (grade.door === "one-way") {
    return skip(`one-way door (${grade.doorReasons[0] ?? "unspecified"})`);
  }
  if (grade.ungraded !== null) return skip(`not graded: ${grade.ungraded}`);
  if (exceeds(grade.risk, MAX_RISK)) return skip(`risk is ${grade.risk}`);
  if (grade.confidence < MIN_CONFIDENCE) {
    return skip(`confidence ${grade.confidence}% is below ${MIN_CONFIDENCE}%`);
  }
  return {
    eligible: true,
    reason: `two-way door, ${grade.risk} risk, confidence ${grade.confidence}%`,
  };
}

export type Conclusion = "success" | "neutral";

// Never "failure": a required merge-warden check must not block a person
// from merging by hand.
export function conclusionFor(verdict: Verdict): Conclusion {
  return verdict.eligible ? "success" : "neutral";
}

// State of the pull request that can change without a new commit.
export interface LiveFacts {
  labels: string[];
  draft: boolean;
  changesRequested: boolean;
}

// Why the app must not merge right now, or null. The one-way-door label
// is tested first, before any other fact is read.
export function liveBlock(facts: LiveFacts): string | null {
  if (facts.labels.includes(ONE_WAY_DOOR_LABEL)) {
    return `one-way door (label: ${ONE_WAY_DOOR_LABEL})`;
  }
  if (facts.labels.includes(NO_AUTO_MERGE_LABEL)) return `label: ${NO_AUTO_MERGE_LABEL}`;
  if (facts.draft) return "pull request is a draft";
  if (facts.changesRequested) return "changes requested";
  return null;
}

// Whether the app may approve and merge now: nothing live blocks it, and
// the head commit's stored verdict is success. A missing verdict, a grade
// still in progress, and every other conclusion all mean no.
export function mergeDecision(
  storedConclusion: string | null,
  facts: LiveFacts,
): Verdict {
  const block = liveBlock(facts);
  if (block !== null) return skip(block);
  if (storedConclusion !== "success") return skip("head commit has no success verdict");
  return { eligible: true, reason: "verdict is success and nothing blocks the merge" };
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

function skip(reason: string): Verdict {
  return { eligible: false, reason };
}
