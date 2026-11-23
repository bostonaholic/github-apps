import { describe, expect, it } from "vitest";
import { buildGrade, type Assessment } from "../src/grade.js";
import { maxLevel, type Level, type Signals } from "../src/signals.js";

const LEVELS: Level[] = ["low", "medium", "high"];

function signals(overrides: Partial<Signals> = {}): Signals {
  return {
    riskFloor: "low",
    floorReasons: [],
    ungradeable: null,
    ...overrides,
  };
}

function assessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    customer: "low",
    data_security: "low",
    recovery: "low",
    door: "two-way",
    door_reason: "a revert restores prior behavior",
    confidence: 95,
    summary: "Docs-only change.",
    findings: [],
    ...overrides,
  };
}

describe("buildGrade: risk", () => {
  it("is low when every input is low", () => {
    const grade = buildGrade(signals(), assessment(), []);
    expect(grade.risk).toBe("low");
    expect(grade.confidence).toBe(95);
    expect(grade.ungraded).toBeNull();
  });

  it("is the highest of the three axes", () => {
    expect(buildGrade(signals(), assessment({ customer: "medium" }), []).risk).toBe("medium");
    expect(buildGrade(signals(), assessment({ data_security: "high" }), []).risk).toBe("high");
    expect(buildGrade(signals(), assessment({ recovery: "medium" }), []).risk).toBe("medium");
  });

  it("is raised by a finding's severity", () => {
    const grade = buildGrade(
      signals(),
      assessment({ findings: [{ severity: "high", text: "drops an index" }] }),
      [],
    );
    expect(grade.risk).toBe("high");
  });

  it("is never below the rule floor, for every combination of inputs", () => {
    for (const floor of LEVELS) {
      for (const customer of LEVELS) {
        for (const data_security of LEVELS) {
          for (const recovery of LEVELS) {
            for (const finding of [null, ...LEVELS]) {
              const grade = buildGrade(
                signals({ riskFloor: floor }),
                assessment({
                  customer,
                  data_security,
                  recovery,
                  findings: finding ? [{ severity: finding, text: "x" }] : [],
                }),
                [],
              );
              expect(maxLevel(grade.risk, floor)).toBe(grade.risk);
              expect(grade.risk).toBe(
                maxLevel(floor, customer, data_security, recovery, finding ?? "low"),
              );
            }
          }
        }
      }
    }
  });
});

describe("buildGrade: door", () => {
  it("is two-way when label and assessment both say so", () => {
    const grade = buildGrade(signals(), assessment(), ["bug"]);
    expect(grade.door).toBe("two-way");
    expect(grade.doorReasons).toEqual([]);
  });

  it("is one-way when the label is present", () => {
    const grade = buildGrade(signals(), assessment(), ["one-way-door"]);
    expect(grade.door).toBe("one-way");
    expect(grade.doorReasons).toEqual(["label: one-way-door"]);
  });

  it("is one-way when the assessment says so", () => {
    const grade = buildGrade(
      signals(),
      assessment({ door: "one-way", door_reason: "publishes a package version" }),
      [],
    );
    expect(grade.door).toBe("one-way");
    expect(grade.doorReasons).toEqual(["assessment: publishes a package version"]);
  });

  it("collects both reasons when label and assessment agree", () => {
    const grade = buildGrade(
      signals(),
      assessment({ door: "one-way", door_reason: "drops a column" }),
      ["one-way-door"],
    );
    expect(grade.doorReasons).toHaveLength(2);
  });
});

describe("buildGrade: no assessment", () => {
  it("is high risk with zero confidence and the signals' reason", () => {
    const grade = buildGrade(signals({ ungradeable: "no text diff for a.png" }), null, []);
    expect(grade.risk).toBe("high");
    expect(grade.confidence).toBe(0);
    expect(grade.assessment).toBeNull();
    expect(grade.ungraded).toBe("no text diff for a.png");
  });

  it("names the model when the diff was gradeable but nothing came back", () => {
    expect(buildGrade(signals(), null, []).ungraded).toBe(
      "the model returned no assessment",
    );
  });

  it("still reports a one-way door from the label", () => {
    const grade = buildGrade(signals(), null, ["one-way-door"]);
    expect(grade.door).toBe("one-way");
  });
});

describe("buildGrade: confidence", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 101])(
    "treats an out-of-range confidence (%s) as zero",
    (confidence) => {
      expect(buildGrade(signals(), assessment({ confidence }), []).confidence).toBe(0);
    },
  );

  it("keeps the bounds 0 and 100", () => {
    expect(buildGrade(signals(), assessment({ confidence: 0 }), []).confidence).toBe(0);
    expect(buildGrade(signals(), assessment({ confidence: 100 }), []).confidence).toBe(100);
  });
});
