import { describe, expect, it } from "vitest";
import {
  buildStatus,
  buildStickyBody,
  inlineText,
  STICKY_MARKER,
} from "../src/format.js";

describe("buildStatus", () => {
  it("fails while tasks are outstanding", () => {
    expect(buildStatus({ disabled: false, total: 5, outstanding: 2 })).toEqual({
      state: "failure",
      description: "2 of 5 tasks remaining",
    });
  });

  it("succeeds when all tasks are complete", () => {
    expect(buildStatus({ disabled: false, total: 3, outstanding: 0 })).toEqual({
      state: "success",
      description: "All 3 tasks complete",
    });
  });

  it("uses singular wording for one task", () => {
    expect(
      buildStatus({ disabled: false, total: 1, outstanding: 1 }).description,
    ).toBe("1 of 1 task remaining");
  });

  it("succeeds when no tasks exist", () => {
    expect(buildStatus({ disabled: false, total: 0, outstanding: 0 })).toEqual({
      state: "success",
      description: "No tasks found",
    });
  });

  it("succeeds when disabled, regardless of outstanding tasks", () => {
    expect(buildStatus({ disabled: true, total: 5, outstanding: 5 })).toEqual({
      state: "success",
      description: "Task list checks are disabled",
    });
  });
});

describe("inlineText", () => {
  it("flattens nested links and images", () => {
    expect(inlineText("see [the docs](https://x) and ![img](https://y)")).toBe(
      "see the docs and img",
    );
  });

  it("collapses whitespace", () => {
    expect(inlineText("a  b\tc")).toBe("a b c");
  });

  it("truncates long text with an ellipsis", () => {
    const result = inlineText("x".repeat(150));
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith("…")).toBe(true);
  });

  it("escapes brackets so link labels stay intact", () => {
    expect(inlineText("fix [P0] bug")).toBe("fix \\[P0\\] bug");
  });
});

describe("buildStickyBody", () => {
  it("lists outstanding items with links and source labels", () => {
    const body = buildStickyBody(
      [
        { text: "run migration", url: "https://pr#c1", source: "comment" },
        { text: "get sign-off", url: "https://pr", source: "description" },
      ],
      3,
    );
    expect(body).toContain(STICKY_MARKER);
    expect(body).toContain("2 of 3 tasks remaining");
    expect(body).toContain("- [run migration](https://pr#c1) — *comment*");
    expect(body).toContain("- [get sign-off](https://pr) — *description*");
  });

  it("renders an all-complete body when nothing is outstanding", () => {
    const body = buildStickyBody([], 4);
    expect(body).toContain(STICKY_MARKER);
    expect(body).toContain("all 4 tasks complete");
  });

  it("does not render outstanding items as parseable checkboxes", () => {
    const body = buildStickyBody(
      [{ text: "x", url: "https://pr#c1", source: "comment" }],
      1,
    );
    // Defense in depth: the sticky comment is excluded by marker, but its
    // items must also never match the task regex.
    expect(body).not.toMatch(/^\s*[-*+]\s+\[[ xX]\]\s/m);
  });
});
