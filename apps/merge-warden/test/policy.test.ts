import { describe, expect, it } from "vitest";
import type { Grade } from "../src/grade.js";
import {
  conclusionFor,
  gradeVerdict,
  hasChangesRequested,
  isApprovedAtHead,
  liveBlock,
  mergeDecision,
  scopeBlock,
  allowsGradeOnly,
  type LiveFacts,
  type ScopeFacts,
} from "../src/policy.js";
import type { Level } from "../src/signals.js";

const LEVELS: Level[] = ["low", "medium", "high"];
const CONFIDENCES = [0, 89, 90, 100];
const AUTHORS = { authors: ["owner"] };

function grade(overrides: Partial<Grade> = {}): Grade {
  return {
    door: "two-way",
    doorReasons: [],
    risk: "low",
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

describe("allowsGradeOnly", () => {
  it("allows a fork or an unlisted author against the default branch", () => {
    expect(allowsGradeOnly(scope({ headRepo: "stranger/r", authorLogin: "stranger" }))).toBe(true);
  });

  it("refuses a base other than the default branch", () => {
    expect(allowsGradeOnly(scope({ baseRef: "feature" }))).toBe(false);
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

const LABEL_SETS = [[], ["one-way-door"], ["no-auto-merge"], ["one-way-door", "no-auto-merge"]];

// Every combination of the facts that can change without a new commit.
function everyLiveFacts(): LiveFacts[] {
  const all: LiveFacts[] = [];
  for (const labels of LABEL_SETS) {
    for (const draft of [false, true]) {
      for (const changesRequested of [false, true]) {
        all.push({ labels, draft, changesRequested });
      }
    }
  }
  return all;
}

const CLEAR: LiveFacts = { labels: [], draft: false, changesRequested: false };

describe("conclusionFor", () => {
  it("is success or neutral, never failure", () => {
    expect(conclusionFor({ eligible: true, reason: "" })).toBe("success");
    expect(conclusionFor({ eligible: false, reason: "" })).toBe("neutral");
  });
});

describe("liveBlock", () => {
  it("is null when nothing blocks", () => {
    expect(liveBlock(CLEAR)).toBeNull();
    expect(liveBlock({ ...CLEAR, labels: ["bug", "docs"] })).toBeNull();
  });

  it("names each block", () => {
    expect(liveBlock({ ...CLEAR, labels: ["one-way-door"] })).toBe(
      "one-way door (label: one-way-door)",
    );
    expect(liveBlock({ ...CLEAR, labels: ["no-auto-merge"] })).toBe("label: no-auto-merge");
    expect(liveBlock({ ...CLEAR, draft: true })).toBe("pull request is a draft");
    expect(liveBlock({ ...CLEAR, changesRequested: true })).toBe("changes requested");
  });

  it("reports the one-way-door label ahead of every other block", () => {
    expect(
      liveBlock({
        labels: ["no-auto-merge", "one-way-door"],
        draft: true,
        changesRequested: true,
      }),
    ).toBe("one-way door (label: one-way-door)");
  });
});

describe("mergeDecision", () => {
  it("allows a success verdict with nothing blocking", () => {
    expect(mergeDecision("success", CLEAR).eligible).toBe(true);
  });

  it.each([null, "neutral", "failure", "cancelled", "skipped", "action_required"])(
    "refuses a stored conclusion of %s",
    (conclusion) => {
      expect(mergeDecision(conclusion, CLEAR)).toEqual({
        eligible: false,
        reason: "head commit has no success verdict",
      });
    },
  );

  it("refuses a success verdict when anything live blocks", () => {
    for (const facts of everyLiveFacts()) {
      if (liveBlock(facts) === null) continue;
      expect(mergeDecision("success", facts).eligible).toBe(false);
    }
  });
});

describe("one-way doors never merge", () => {
  // The path a grade takes in production: gradeVerdict → conclusionFor is
  // stored on the check run, then mergeDecision reads it back with live facts.
  it("for every one-way grade under every combination of the other inputs", () => {
    let cases = 0;
    for (const risk of LEVELS) {
      for (const confidence of CONFIDENCES) {
        for (const ungraded of [null, "no text diff for a.png"]) {
          for (const doorReasons of [[], ["data change: a.sql"]]) {
            const stored = conclusionFor(
              gradeVerdict(grade({ door: "one-way", doorReasons, risk, confidence, ungraded })),
            );
            expect(stored).toBe("neutral");
            for (const facts of everyLiveFacts()) {
              expect(mergeDecision(stored, facts).eligible).toBe(false);
              cases += 1;
            }
          }
        }
      }
    }
    expect(cases).toBe(768);
  });

  it("for the one-way-door label against every stored conclusion, including a stale success", () => {
    let cases = 0;
    for (const conclusion of ["success", "neutral", "failure", null]) {
      for (const facts of everyLiveFacts()) {
        if (!facts.labels.includes("one-way-door")) continue;
        const decision = mergeDecision(conclusion, facts);
        expect(decision.eligible).toBe(false);
        expect(decision.reason).toBe("one-way door (label: one-way-door)");
        cases += 1;
      }
    }
    expect(cases).toBe(32);
  });
});

describe("hasChangesRequested", () => {
  const review = (userLogin: string | null, state: string) => ({
    userLogin,
    state,
    commitId: "head1",
  });

  it("is false with no reviews or only approvals and comments", () => {
    expect(hasChangesRequested([])).toBe(false);
    expect(hasChangesRequested([review("a", "APPROVED"), review("b", "COMMENTED")])).toBe(false);
  });

  it("is true while a reviewer's latest verdict is changes requested", () => {
    expect(hasChangesRequested([review("a", "CHANGES_REQUESTED")])).toBe(true);
    expect(
      hasChangesRequested([review("a", "APPROVED"), review("a", "CHANGES_REQUESTED")]),
    ).toBe(true);
  });

  it("is cleared by the same reviewer's later approval, not by a comment", () => {
    expect(
      hasChangesRequested([review("a", "CHANGES_REQUESTED"), review("a", "APPROVED")]),
    ).toBe(false);
    expect(
      hasChangesRequested([review("a", "CHANGES_REQUESTED"), review("a", "COMMENTED")]),
    ).toBe(true);
  });

  it("is not cleared by another reviewer's approval", () => {
    expect(
      hasChangesRequested([review("a", "CHANGES_REQUESTED"), review("b", "APPROVED")]),
    ).toBe(true);
  });
});

describe("isApprovedAtHead", () => {
  it("is true only for an approval on the head commit", () => {
    const at = (commitId: string, state = "APPROVED") => ({ userLogin: "a", state, commitId });
    expect(isApprovedAtHead([at("head1")], "head1")).toBe(true);
    expect(isApprovedAtHead([at("old")], "head1")).toBe(false);
    expect(isApprovedAtHead([at("head1", "COMMENTED")], "head1")).toBe(false);
    expect(isApprovedAtHead([], "head1")).toBe(false);
  });
});
