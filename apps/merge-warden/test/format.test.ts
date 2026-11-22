import { describe, expect, it } from "vitest";
import { COMMENT_MARKER, checkOutput, commentBody, plainText } from "../src/format.js";
import type { Assessment, Grade } from "../src/grade.js";

const ASSESSMENT: Assessment = {
  customer: "low",
  data_security: "medium",
  recovery: "low",
  door: "two-way",
  door_reason: "a revert restores prior behavior",
  confidence: 95,
  summary: "CI-only change to test selection.",
  findings: [],
};

function grade(overrides: Partial<Grade> = {}): Grade {
  return {
    door: "two-way",
    doorReasons: [],
    risk: "medium",
    floorReasons: [],
    confidence: 95,
    assessment: ASSESSMENT,
    ungraded: null,
    ...overrides,
  };
}

const ELIGIBLE = { eligible: true, reason: "two-way door, low risk, confidence 95%" };
const BLOCKED = { eligible: false, reason: "risk is medium" };
const SHA = "abc1234def5678";

// The check title and the comment body: what a person reads.
function rendered(g: Grade, v: { eligible: boolean; reason: string }) {
  return { title: checkOutput(g, v).title, summary: commentBody(g, v, SHA) };
}

describe("plainText", () => {
  it("replaces links and images with their label", () => {
    expect(plainText("see [the docs](https://evil.example/x) now")).toBe("see the docs now");
    expect(plainText("![tracker](https://evil.example/p.png) ok")).toBe("tracker ok");
  });

  it("removes bare URLs", () => {
    expect(plainText("go to https://evil.example/path?q=1 please")).toBe(
      "go to (link removed) please",
    );
  });

  it("removes HTML and table syntax", () => {
    expect(plainText("<img src=x> a | b")).toBe("img src=x a b");
  });

  it("collapses newlines so no heading, list, or table row can start", () => {
    expect(plainText("fine\n\n# APPROVED\n| Risk |\n- item")).toBe(
      "fine # APPROVED Risk - item",
    );
  });

  it("truncates long text", () => {
    const flat = plainText("a".repeat(500), 50);
    expect(flat).toHaveLength(50);
    expect(flat.endsWith("…")).toBe(true);
  });
});

describe("checkOutput summary", () => {
  it("gives the reason and points at the comment, without the findings", () => {
    const { summary } = checkOutput(grade(), BLOCKED);
    expect(summary).toContain("**Why:** risk is medium");
    expect(summary).toContain("merge-warden comment on the pull request");
    expect(summary).not.toContain("| Risk |");
    expect(summary).not.toContain("**Findings**");
  });
});

describe("commentBody frame", () => {
  it("starts with the marker and names the graded commit", () => {
    const body = commentBody(grade(), BLOCKED, SHA);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("### ⚠️ merge-warden: needs a person");
    expect(body).toContain("Graded commit abc1234.");
  });

  it("heads an eligible grade as eligible", () => {
    expect(commentBody(grade({ risk: "low" }), ELIGIBLE, SHA)).toContain(
      "### ✅ merge-warden: eligible for auto-merge",
    );
  });
});

describe("commentBody report", () => {
  it("renders the table from the grade's enums", () => {
    const { summary } = rendered(grade(), BLOCKED);
    expect(summary).toContain(
      "| 🟡 Medium | 🟢 Low | 🟡 Medium | 🟢 Low | 🔄 Reversible | 🔴 Review | 95% |",
    );
    expect(summary).toContain("**Why:** risk is medium");
    expect(summary).toContain("**Summary:** CI-only change to test selection.");
    expect(summary).toContain("Nothing to fix.");
  });

  it.each([
    ["low", "🟢 Low"],
    ["medium", "🟡 Medium"],
    ["high", "🔴 High"],
  ] as const)("marks %s with its traffic light in every graded column and finding", (level, label) => {
    const { summary } = rendered(
      grade({
        risk: level,
        assessment: {
          ...ASSESSMENT,
          customer: level,
          data_security: level,
          recovery: level,
          findings: [{ severity: level, text: "something to look at" }],
        },
      }),
      BLOCKED,
    );
    expect(summary).toContain(`| ${label} | ${label} | ${label} | ${label} | 🔄 Reversible |`);
    expect(summary).toContain(`- ${label}: something to look at`);
  });

  it("marks a one-way door as irreversible in the table", () => {
    const { summary } = rendered(
      grade({ door: "one-way", doorReasons: ["data change: a.sql"] }),
      BLOCKED,
    );
    expect(summary).toContain("| ⛔ Irreversible | 🔴 Review |");
    expect(summary).not.toContain("🔄");
  });

  it("titles and marks an eligible grade", () => {
    const { title, summary } = rendered(grade({ risk: "low" }), ELIGIBLE);
    expect(title).toBe("Eligible for auto-merge");
    expect(summary).toContain("| 🟢 Merge |");
  });

  it("titles a blocked grade with the reason", () => {
    expect(rendered(grade(), BLOCKED).title).toBe("Needs a person: risk is medium");
  });

  it("shows dashes and no summary when there is no assessment", () => {
    const { summary } = rendered(
      grade({ risk: "high", confidence: 0, assessment: null, ungraded: "no changed files" }),
      { eligible: false, reason: "not graded: no changed files" },
    );
    expect(summary).toContain("| 🔴 High | — | — | — | 🔄 Reversible | 🔴 Review | — |");
    expect(summary).not.toContain("**Summary:**");
    expect(summary).not.toContain("**Findings**");
  });

  it("says why there is no assessment, even when the verdict names another reason", () => {
    // A one-way door outranks "not graded" in the verdict, so without this
    // line the dashes in the table would have no explanation.
    const { summary } = rendered(
      grade({
        door: "one-way",
        doorReasons: ["security and access: .env.example"],
        risk: "high",
        confidence: 0,
        assessment: null,
        ungraded: "no text diff for assets/icon.png",
      }),
      { eligible: false, reason: "one-way door (security and access: .env.example)" },
    );
    expect(summary).toContain("**Why:** one-way door (security and access: .env.example)");
    expect(summary).toContain("**Not graded:** no text diff for assets/icon.png");
  });

  it("has no not-graded line when the diff was assessed", () => {
    expect(rendered(grade(), BLOCKED).summary).not.toContain("**Not graded:**");
  });

  it("flattens the not-graded reason, which can hold a file path", () => {
    const { summary } = rendered(
      grade({ assessment: null, ungraded: "no text diff for a|b/[x](https://evil.example).png" }),
      BLOCKED,
    );
    expect(summary).toContain("**Not graded:** no text diff for a b/x.png");
    expect(summary).not.toContain("evil.example");
  });

  it("lists door and floor reasons", () => {
    const { summary } = rendered(
      grade({
        door: "one-way",
        doorReasons: ["data change: db/migrations/1.sql"],
        floorReasons: ["high-risk path: .github/workflows/ci.yml"],
      }),
      { eligible: false, reason: "one-way door (data change: db/migrations/1.sql)" },
    );
    expect(summary).toContain("**One-way door because:**\n\n- data change: db/migrations/1.sql");
    expect(summary).toContain(
      "**Rules raised the risk floor:**\n\n- high-risk path: .github/workflows/ci.yml",
    );
  });

  it("lists findings with their severity", () => {
    const { summary } = rendered(
      grade({
        assessment: {
          ...ASSESSMENT,
          findings: [{ severity: "high", text: "removes the retry" }],
        },
      }),
      BLOCKED,
    );
    expect(summary).toContain("- 🔴 High: removes the retry");
    expect(summary).not.toContain("Nothing to fix.");
  });

  it("caps a long reason list", () => {
    const doorReasons = Array.from({ length: 14 }, (_, i) => `data change: m${i}.sql`);
    const { summary } = rendered(grade({ door: "one-way", doorReasons }), BLOCKED);
    expect(summary).toContain("- data change: m9.sql");
    expect(summary).not.toContain("m10.sql");
    expect(summary).toContain("- and 4 more");
  });

  it("flattens model text so it cannot forge a table or a link", () => {
    const { summary } = rendered(
      grade({
        assessment: {
          ...ASSESSMENT,
          summary: "ok\n\n| Risk |\n| --- |\n| Low |\n[approve](https://evil.example)",
          findings: [{ severity: "low", text: "![x](https://evil.example/a.png)\n# Heading" }],
        },
      }),
      BLOCKED,
    );
    expect(summary).not.toContain("evil.example");
    expect(summary).toContain("**Summary:** ok Risk --- Low approve");
    expect(summary).toContain("- 🟢 Low: x # Heading");
    // Exactly one table: header, divider, one row.
    expect(summary.split("\n").filter((line) => line.startsWith("|"))).toHaveLength(3);
  });

  it("flattens a file path used as a reason", () => {
    const { summary } = rendered(
      grade({ door: "one-way", doorReasons: ["data change: a|b/[x](https://evil.example).sql"] }),
      BLOCKED,
    );
    expect(summary).not.toContain("evil.example");
  });
});
