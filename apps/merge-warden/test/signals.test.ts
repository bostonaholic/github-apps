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

describe("readSignals", () => {
  it.each([
    "src/app.ts",
    "db/migrations/001_add_users.sql",
    ".env",
    ".github/workflows/ci.yml",
  ])("finds %s gradeable, whatever its path", (path) => {
    expect(signals([file(path)]).ungradeable).toBeNull();
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
