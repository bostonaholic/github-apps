import { describe, expect, it } from "vitest";
import {
  MAX_DIFF_CHARS,
  MAX_FILES,
  maxLevel,
  readSignals,
  type ChangedFile,
} from "../src/signals.js";

const NO_RULES = { one_way_door_paths: [], high_risk_paths: [] };

function file(filename: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return { filename, status: "modified", changes: 2, patch: "@@ -1 +1 @@\n-a\n+b", ...overrides };
}

function signals(files: ChangedFile[], rules = NO_RULES) {
  return readSignals(files, rules, files.length);
}

describe("maxLevel", () => {
  it("returns the highest level, low when given none", () => {
    expect(maxLevel()).toBe("low");
    expect(maxLevel("low", "high", "medium")).toBe("high");
    expect(maxLevel("medium", "low")).toBe("medium");
  });
});

describe("readSignals: door", () => {
  it("is two-way with no reasons for an ordinary source change", () => {
    const result = signals([file("src/app.ts"), file("README.md")]);
    expect(result.door).toBe("two-way");
    expect(result.doorReasons).toEqual([]);
    expect(result.riskFloor).toBe("low");
    expect(result.ungradeable).toBeNull();
  });

  it.each([
    ["db/migrations/20260101_add_users.rb", "data change"],
    ["migrations/001.py", "data change"],
    ["db/migrate/001_init.rb", "data change"],
    ["scripts/backfill.sql", "data change"],
    ["db/schema.rb", "data change"],
    ["prisma/schema.prisma", "data change"],
    ["api/openapi.yaml", "public contract"],
    ["openapi-v2.json", "public contract"],
    ["proto/events.proto", "public contract"],
    ["schema/api.graphql", "public contract"],
    [".env", "security and access"],
    ["config/.env.production", "security and access"],
    ["deploy/secrets/prod.yml", "security and access"],
    ["src/auth/session.ts", "security and access"],
    ["infra/iam/roles.json", "security and access"],
    ["infra/main.tf", "security and access"],
  ])("marks %s a one-way door (%s)", (path, category) => {
    const result = signals([file(path)]);
    expect(result.door).toBe("one-way");
    expect(result.doorReasons).toContain(`${category}: ${path}`);
  });

  it.each([".env.example", "apps/web/.env.sample", ".env.template", "config/.env.dist"])(
    "keeps the env template %s a two-way door",
    (path) => {
      const result = signals([file(path)]);
      expect(result.door).toBe("two-way");
      expect(result.doorReasons).toEqual([]);
    },
  );

  it("matches a path inside a dot-directory", () => {
    expect(signals([file(".deploy/secrets/key.yml")]).door).toBe("one-way");
  });

  it("matches case-insensitively", () => {
    expect(signals([file("DB/Migrations/001.SQL")]).door).toBe("one-way");
  });

  it("matches the previous name of a renamed file", () => {
    const result = signals([
      file("archive/old_change.txt", {
        status: "renamed",
        previous_filename: "db/migrations/001_change.rb",
        changes: 0,
        patch: undefined,
      }),
    ]);
    expect(result.door).toBe("one-way");
    expect(result.doorReasons).toEqual(["data change: db/migrations/001_change.rb"]);
  });

  it("adds configured globs without replacing the built-in ones", () => {
    const rules = { one_way_door_paths: ["billing/**"], high_risk_paths: [] };
    expect(signals([file("billing/invoice.ts")], rules).doorReasons).toEqual([
      "configured one-way path: billing/invoice.ts",
    ]);
    expect(signals([file("db/migrations/1.sql")], rules).door).toBe("one-way");
  });
});

describe("readSignals: risk floor", () => {
  it.each([".github/workflows/ci.yml", ".github/merge-warden.yml", ".github/CODEOWNERS", "CODEOWNERS"])(
    "floors %s at high while leaving the door two-way",
    (path) => {
      const result = signals([file(path)]);
      expect(result.riskFloor).toBe("high");
      expect(result.door).toBe("two-way");
      expect(result.floorReasons).toEqual([`high-risk path: ${path}`]);
    },
  );

  it("adds configured high-risk globs", () => {
    const rules = { one_way_door_paths: [], high_risk_paths: ["infra/**"] };
    expect(signals([file("infra/deploy.sh")], rules).riskFloor).toBe("high");
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

  it("keeps high when a large diff also touches a high-risk path", () => {
    const result = signals([file(".github/workflows/ci.yml", { changes: 900 })]);
    expect(result.riskFloor).toBe("high");
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
    const result = readSignals([file("a.ts")], NO_RULES, 3);
    expect(result.ungradeable).toBe("file list is incomplete (1 of 3)");
  });

  it("rejects a diff over the size budget", () => {
    const big = "x".repeat(MAX_DIFF_CHARS / 2 + 1);
    const result = signals([file("a.ts", { patch: big }), file("b.ts", { patch: big })]);
    expect(result.ungradeable).toBe("diff exceeds the size budget");
  });

  it("still reports the door for a diff it cannot grade", () => {
    const result = signals([file("db/migrations/dump.bin", { patch: undefined })]);
    expect(result.door).toBe("one-way");
    expect(result.ungradeable).not.toBeNull();
  });
});
