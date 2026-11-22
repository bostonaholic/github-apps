import { describe, expect, it } from "vitest";
import { checkOutput, plainText } from "../src/format.js";
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

describe("checkOutput", () => {
  it("renders the table from the grade's enums", () => {
    const { summary } = checkOutput(grade(), BLOCKED);
    expect(summary).toContain(
      "| Medium | Low | Medium | Low | two-way | NEEDS A PERSON | 95% |",
    );
    expect(summary).toContain("**Why:** risk is medium");
    expect(summary).toContain("**Summary:** CI-only change to test selection.");
    expect(summary).toContain("Nothing to fix.");
  });

  it("titles and marks an eligible grade", () => {
    const { title, summary } = checkOutput(grade({ risk: "low" }), ELIGIBLE);
    expect(title).toBe("Eligible for auto-merge");
    expect(summary).toContain("| AUTO-MERGE |");
  });

  it("titles a blocked grade with the reason", () => {
    expect(checkOutput(grade(), BLOCKED).title).toBe("Needs a person: risk is medium");
  });

  it("shows dashes and no summary when there is no assessment", () => {
    const { summary } = checkOutput(
      grade({ risk: "high", confidence: 0, assessment: null, ungraded: "no changed files" }),
      { eligible: false, reason: "not graded: no changed files" },
    );
    expect(summary).toContain("| High | — | — | — | two-way | NEEDS A PERSON | — |");
    expect(summary).not.toContain("**Summary:**");
    expect(summary).not.toContain("**Findings**");
  });

  it("lists door and floor reasons", () => {
    const { summary } = checkOutput(
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
    const { summary } = checkOutput(
      grade({
        assessment: {
          ...ASSESSMENT,
          findings: [{ severity: "high", text: "removes the retry" }],
        },
      }),
      BLOCKED,
    );
    expect(summary).toContain("- High: removes the retry");
    expect(summary).not.toContain("Nothing to fix.");
  });

  it("caps a long reason list", () => {
    const doorReasons = Array.from({ length: 14 }, (_, i) => `data change: m${i}.sql`);
    const { summary } = checkOutput(grade({ door: "one-way", doorReasons }), BLOCKED);
    expect(summary).toContain("- data change: m9.sql");
    expect(summary).not.toContain("m10.sql");
    expect(summary).toContain("- and 4 more");
  });

  it("flattens model text so it cannot forge a table or a link", () => {
    const { summary } = checkOutput(
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
    expect(summary).toContain("- Low: x # Heading");
    // Exactly one table: header, divider, one row.
    expect(summary.split("\n").filter((line) => line.startsWith("|"))).toHaveLength(3);
  });

  it("flattens a file path used as a reason", () => {
    const { summary } = checkOutput(
      grade({ door: "one-way", doorReasons: ["data change: a|b/[x](https://evil.example).sql"] }),
      BLOCKED,
    );
    expect(summary).not.toContain("evil.example");
  });
});
