import { describe, expect, it } from "vitest";
import type { Grade } from "../src/grade.js";
import { gradeVerdict, scopeBlock, type ScopeFacts } from "../src/policy.js";
import type { Level } from "../src/signals.js";

const LEVELS: Level[] = ["low", "medium", "high"];
const CONFIDENCES = [0, 89, 90, 100];
const AUTHORS = { authors: ["owner"] };

function grade(overrides: Partial<Grade> = {}): Grade {
  return {
    door: "two-way",
    doorReasons: [],
    risk: "low",
    floorReasons: [],
    confidence: 95,
    assessment: null,
    ungraded: null,
    ...overrides,
  };
}

function scope(overrides: Partial<ScopeFacts> = {}): ScopeFacts {
  return {
    authorLogin: "owner",
    headRepo: "owner/r",
    baseRepo: "owner/r",
    baseRef: "main",
    defaultBranch: "main",
    ...overrides,
  };
}

describe("scopeBlock", () => {
  it("passes the owner's same-repo PR against the default branch", () => {
    expect(scopeBlock(scope(), AUTHORS)).toBeNull();
  });

  it("compares the author case-insensitively", () => {
    expect(scopeBlock(scope({ authorLogin: "Owner" }), AUTHORS)).toBeNull();
  });

  it("blocks an author outside the allowlist", () => {
    expect(scopeBlock(scope({ authorLogin: "stranger" }), AUTHORS)).toBe(
      "author is not in the allowlist",
    );
    expect(scopeBlock(scope({ authorLogin: null }), AUTHORS)).not.toBeNull();
    expect(scopeBlock(scope(), { authors: [] })).not.toBeNull();
  });

  it("blocks a fork, including a deleted one", () => {
    expect(scopeBlock(scope({ headRepo: "stranger/r" }), AUTHORS)).toBe(
      "head branch is in a fork",
    );
    expect(scopeBlock(scope({ headRepo: null }), AUTHORS)).toBe(
      "head branch is in a fork",
    );
  });

  it("blocks a base other than the default branch", () => {
    expect(scopeBlock(scope({ baseRef: "feature" }), AUTHORS)).toBe(
      "base is not the default branch",
    );
  });
});

describe("gradeVerdict", () => {
  it("makes a low-risk, confident, two-way grade eligible", () => {
    expect(gradeVerdict(grade())).toEqual({
      eligible: true,
      reason: "two-way door, low risk, confidence 95%",
    });
  });

  it("never makes a one-way door eligible, whatever else the grade says", () => {
    let cases = 0;
    for (const risk of LEVELS) {
      for (const confidence of CONFIDENCES) {
        for (const ungraded of [null, "no text diff for a.png"]) {
          for (const doorReasons of [[], ["data change: a.sql"]]) {
            const verdict = gradeVerdict(
              grade({ door: "one-way", doorReasons, risk, confidence, ungraded }),
            );
            expect(verdict.eligible).toBe(false);
            expect(verdict.reason).toMatch(/^one-way door/);
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBe(48);
  });

  it("blocks an ungraded diff", () => {
    expect(gradeVerdict(grade({ ungraded: "diff exceeds the size budget" }))).toEqual({
      eligible: false,
      reason: "not graded: diff exceeds the size budget",
    });
  });

  it("blocks medium and high risk", () => {
    expect(gradeVerdict(grade({ risk: "medium" })).reason).toBe("risk is medium");
    expect(gradeVerdict(grade({ risk: "high" })).eligible).toBe(false);
  });

  it("draws the confidence line at 90", () => {
    expect(gradeVerdict(grade({ confidence: 89 }))).toEqual({
      eligible: false,
      reason: "confidence 89% is below 90%",
    });
    expect(gradeVerdict(grade({ confidence: 90 })).eligible).toBe(true);
  });
});
