import { describe, expect, it } from "vitest";
import {
  hasDisableMarker,
  hasIgnoreMarker,
  isStickyComment,
  parseTasks,
} from "../src/parse.js";

describe("parseTasks", () => {
  it("parses unchecked and checked items", () => {
    const tasks = parseTasks("- [ ] run migration\n- [x] get sign-off\n- [X] deploy");
    expect(tasks).toEqual([
      { text: "run migration", checked: false },
      { text: "get sign-off", checked: true },
      { text: "deploy", checked: true },
    ]);
  });

  it("accepts *, +, and ordered list markers", () => {
    const tasks = parseTasks("* [ ] a\n+ [ ] b\n1. [ ] c\n2) [ ] d");
    expect(tasks).toHaveLength(4);
  });

  it("counts nested (indented) items", () => {
    const tasks = parseTasks("- [ ] parent\n  - [ ] child\n    - [x] grandchild");
    expect(tasks).toHaveLength(3);
  });

  it("ignores lines that are not task items", () => {
    const tasks = parseTasks(
      "- plain bullet\n-[ ] no space after dash\nsome [ ] mid-sentence\n[x] no list marker",
    );
    expect(tasks).toEqual([]);
  });

  it("ignores items with no text", () => {
    expect(parseTasks("- [ ]\n- [ ]   \n- [x] real")).toEqual([
      { text: "real", checked: true },
    ]);
  });

  it("ignores checkboxes inside fenced code blocks", () => {
    const body = [
      "- [ ] real task",
      "```markdown",
      "- [ ] example, not a task",
      "```",
      "~~~",
      "- [ ] also not a task",
      "~~~",
    ].join("\n");
    expect(parseTasks(body)).toEqual([{ text: "real task", checked: false }]);
  });

  it("handles a backtick fence inside a tilde fence", () => {
    const body = "~~~\n```\n- [ ] still inside the tilde fence\n~~~\n- [ ] real";
    expect(parseTasks(body)).toEqual([{ text: "real", checked: false }]);
  });

  it("handles CRLF line endings", () => {
    expect(parseTasks("- [ ] one\r\n- [x] two")).toHaveLength(2);
  });

  it("trims task text", () => {
    expect(parseTasks("- [ ]   spaced out   ")[0].text).toBe("spaced out");
  });
});

describe("markers", () => {
  it("matches with flexible whitespace and case", () => {
    expect(hasIgnoreMarker("notes <!-- task-list: ignore -->")).toBe(true);
    expect(hasIgnoreMarker("<!--task-list:ignore-->")).toBe(true);
    expect(hasIgnoreMarker("<!-- TASK-LIST: IGNORE -->")).toBe(true);
    expect(hasIgnoreMarker("no marker here")).toBe(false);
  });

  it("distinguishes the three markers", () => {
    expect(hasDisableMarker("<!-- task-list: disable -->")).toBe(true);
    expect(hasDisableMarker("<!-- task-list: ignore -->")).toBe(false);
    expect(isStickyComment("<!-- task-list: sticky-comment -->")).toBe(true);
    expect(isStickyComment("<!-- task-list: disable -->")).toBe(false);
  });
});
