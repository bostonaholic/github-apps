import { describe, expect, it } from "vitest";
import {
  MAX_DIFF_CHARS,
  MAX_FILES,
  maxLevel,
  readSignals,
  type ChangedFile,
} from "../src/signals.js";

function file(filename: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return { filename, status: "modified", changes: 2, patch: "@@ -1 +1 @@\n-a\n+b", ...overrides };
}

function signals(files: ChangedFile[]) {
  return readSignals(files, files.length);
}

describe("maxLevel", () => {
  it("returns the highest level, low when given none", () => {
    expect(maxLevel()).toBe("low");
    expect(maxLevel("low", "high", "medium")).toBe("high");
    expect(maxLevel("medium", "low")).toBe("medium");
  });
});

describe("readSignals: risk floor", () => {
  it("is low with no reasons for an ordinary change", () => {
    const result = signals([file("src/app.ts"), file("README.md")]);
    expect(result.riskFloor).toBe("low");
    expect(result.floorReasons).toEqual([]);
    expect(result.ungradeable).toBeNull();
  });

  it.each([
    "db/migrations/001_add_users.sql",
    ".env",
    "src/auth/session.ts",
    ".github/workflows/ci.yml",
    "CODEOWNERS",
  ])("does not judge %s by its path", (path) => {
    const result = signals([file(path)]);
    expect(result.riskFloor).toBe("low");
    expect(result.floorReasons).toEqual([]);
  });

  it("floors a diff over 400 changed lines at medium", () => {
    expect(signals([file("a.ts", { changes: 400 })]).riskFloor).toBe("low");
    expect(signals([file("a.ts", { changes: 401 })]).riskFloor).toBe("medium");
  });

  it("floors a diff over 20 files at medium", () => {
    const files = (count: number) =>
      Array.from({ length: count }, (_, i) => file(`src/f${i}.ts`, { changes: 1 }));
    expect(signals(files(20)).riskFloor).toBe("low");
    expect(signals(files(21)).riskFloor).toBe("medium");
  });
});

describe("readSignals: gradeable", () => {
  it("rejects an empty file list", () => {
    expect(signals([]).ungradeable).toBe("no changed files");
  });

  it("rejects a changed file with no patch", () => {
    const result = signals([file("logo.png", { changes: 1, patch: undefined })]);
    expect(result.ungradeable).toBe("no text diff for logo.png");
  });

  // GitHub reports a binary file with zero changed lines and no patch,
  // the same numbers as a pure rename. Only the status tells them apart.
  it.each(["added", "modified", "removed"])(
    "rejects a binary file that was %s, which has zero changes and no patch",
    (status) => {
      const result = signals([file("assets/icon.png", { status, changes: 0, patch: undefined })]);
      expect(result.ungradeable).toBe("no text diff for assets/icon.png");
    },
  );

  it("rejects a renamed file whose content also changed without a patch", () => {
    const result = signals([
      file("b.bin", { status: "renamed", previous_filename: "a.bin", changes: 3, patch: undefined }),
    ]);
    expect(result.ungradeable).toBe("no text diff for b.bin");
  });

  it("accepts a pure rename, which has no changes and no patch", () => {
    const result = signals([
      file("b.ts", { status: "renamed", previous_filename: "a.ts", changes: 0, patch: undefined }),
    ]);
    expect(result.ungradeable).toBeNull();
  });

  it("rejects a file list at the endpoint's cap", () => {
    const files = Array.from({ length: MAX_FILES }, (_, i) => file(`f${i}.ts`));
    expect(signals(files).ungradeable).toBe("300 or more files changed");
  });

  it("rejects a file list that does not match the pull request's count", () => {
    const result = readSignals([file("a.ts")], 3);
    expect(result.ungradeable).toBe("file list is incomplete (1 of 3)");
  });

  it("rejects a diff over the size budget", () => {
    const big = "x".repeat(MAX_DIFF_CHARS / 2 + 1);
    const result = signals([file("a.ts", { patch: big }), file("b.ts", { patch: big })]);
    expect(result.ungradeable).toBe("diff exceeds the size budget");
  });
});
