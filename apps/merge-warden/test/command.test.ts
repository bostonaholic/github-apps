import { describe, expect, it } from "vitest";
import { canGrade, parseCommand } from "../src/command.js";

describe("parseCommand", () => {
  it("grades with the default model when no model is named", () => {
    expect(parseCommand("/merge-warden grade")).toEqual({ kind: "grade", model: null });
  });

  it("maps aliases to model IDs", () => {
    expect(parseCommand("/merge-warden grade opus")).toEqual({
      kind: "grade",
      model: "claude-opus-5-5",
    });
    expect(parseCommand("/merge-warden grade Sonnet")).toEqual({
      kind: "grade",
      model: "claude-sonnet-5-5",
    });
  });

  it("passes a full claude model ID through", () => {
    expect(parseCommand("/merge-warden grade claude-opus-5-5")).toEqual({
      kind: "grade",
      model: "claude-opus-5-5",
    });
  });

  it("finds the command on its own line among others", () => {
    expect(parseCommand("I disagree.\r\n  /merge-warden grade opus  \nthanks")).toEqual({
      kind: "grade",
      model: "claude-opus-5-5",
    });
  });

  it("reports a model that is neither an alias nor a claude ID", () => {
    expect(parseCommand("/merge-warden grade gpt-5")).toEqual({ kind: "unknown-model" });
    expect(parseCommand("/merge-warden grade claude-<x>")).toEqual({ kind: "unknown-model" });
  });

  it("ignores the command inside prose or with extra words", () => {
    expect(parseCommand("try `/merge-warden grade opus` later")).toBeNull();
    expect(parseCommand("/merge-warden grade opus now")).toBeNull();
    expect(parseCommand("/merge-warden regrade")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });
});

describe("canGrade", () => {
  it("allows write and admin, nothing less", () => {
    expect(canGrade("admin")).toBe(true);
    expect(canGrade("write")).toBe(true);
    expect(canGrade("read")).toBe(false);
    expect(canGrade("none")).toBe(false);
  });
});
