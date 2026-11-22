// Pure policy: whether a pull request is in scope, and whether a grade
// makes its commit eligible for auto-merge. No I/O.

import type { WardenConfig } from "./config.js";
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

function skip(reason: string): Verdict {
  return { eligible: false, reason };
}
