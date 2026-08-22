import { describe, expect, it } from "vitest";
import {
  bump,
  isDependabotBranch,
  isSecurityUpdate,
  parseUpdates,
} from "../src/parse.js";

describe("parseUpdates", () => {
  it("parses a plain npm bump title", () => {
    expect(parseUpdates("Bump lodash from 4.17.20 to 4.17.21", "")).toEqual([
      { name: "lodash", from: "4.17.20", to: "4.17.21", bump: "patch" },
    ]);
  });

  it("parses a title with a commit-message prefix", () => {
    expect(
      parseUpdates("chore(deps-dev): bump vitest from 3.1.0 to 3.2.0", ""),
    ).toEqual([{ name: "vitest", from: "3.1.0", to: "3.2.0", bump: "minor" }]);
  });

  it("parses a scoped package with a directory suffix", () => {
    expect(
      parseUpdates(
        "Bump @types/node from 22.15.0 to 23.0.0 in /task-list-completed",
        "",
      ),
    ).toEqual([
      { name: "@types/node", from: "22.15.0", to: "23.0.0", bump: "major" },
    ]);
  });

  it("parses a github-actions major (bare numbers)", () => {
    expect(parseUpdates("Bump actions/checkout from 3 to 4", "")).toEqual([
      { name: "actions/checkout", from: "3", to: "4", bump: "major" },
    ]);
  });

  it("marks SHA-pinned action bumps as unknown", () => {
    const updates = parseUpdates(
      "Bump actions/checkout from 8f4b7f84864484a7bf31766abe9204da3cbe65b3 to 11bd71901bbe5b1630ceea73d27597364c9af683",
      "",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].bump).toBe("unknown");
  });

  it("parses a bundler requirement update", () => {
    expect(
      parseUpdates("Update rake requirement from ~> 10.0 to ~> 13.0", ""),
    ).toEqual([{ name: "rake", from: "~> 10.0", to: "~> 13.0", bump: "major" }]);
  });

  it("parses a requirement update with a directory suffix", () => {
    expect(
      parseUpdates("Update rspec requirement from ~> 3.12 to ~> 3.13 in /api", ""),
    ).toEqual([{ name: "rspec", from: "~> 3.12", to: "~> 3.13", bump: "minor" }]);
  });

  it("parses every update in a grouped PR from the body", () => {
    const body = [
      "Bumps the dev-dependencies group with 3 updates:",
      "",
      "Updates `eslint` from 8.57.0 to 8.57.1",
      "Updates [`typescript`](https://github.com/microsoft/TypeScript) from 5.7.0 to 5.8.0",
      "Updates `vite` from 5.0.0 to 6.0.0",
    ].join("\n");
    expect(
      parseUpdates("Bump the dev-dependencies group with 3 updates", body),
    ).toEqual([
      { name: "eslint", from: "8.57.0", to: "8.57.1", bump: "patch" },
      { name: "typescript", from: "5.7.0", to: "5.8.0", bump: "minor" },
      { name: "vite", from: "5.0.0", to: "6.0.0", bump: "major" },
    ]);
  });

  it("parses a grouped title across directories", () => {
    const body = "Updates `esbuild` from 0.20.0 to 0.20.1";
    expect(
      parseUpdates(
        "Bump the npm_and_yarn group across 2 directories with 1 update",
        body,
      ),
    ).toEqual([{ name: "esbuild", from: "0.20.0", to: "0.20.1", bump: "patch" }]);
  });

  it("returns no updates for a grouped title whose body has no update lines", () => {
    expect(parseUpdates("Bump the deps group with 2 updates", "prose only")).toEqual([]);
  });

  it("returns no updates for an unrecognized title", () => {
    expect(parseUpdates("Add feature flag for checkout", "")).toEqual([]);
    expect(parseUpdates("Revert lodash upgrade", "")).toEqual([]);
  });
});

describe("bump", () => {
  it.each([
    ["1.0.0", "1.0.1", "patch"],
    ["1.0.0", "1.1.0", "minor"],
    ["1.0.0", "2.0.0", "major"],
    ["3", "4", "major"],
    ["2.1", "2.2", "minor"],
    ["2.1", "2.1.1", "patch"],
    ["v3", "v4", "major"],
    ["4.17.20", "4.18", "minor"],
    ["0.20.0", "0.20.1", "patch"],
    ["~> 13.0", "~> 13.1", "minor"],
    [">= 2.0", ">= 3.0", "major"],
  ])("%s → %s is %s", (from, to, expected) => {
    expect(bump(from, to)).toBe(expected);
  });

  it.each([
    ["1.0.0", "1.0.0"],
    ["1.0.0-beta.1", "1.0.0"],
    ["1.0.0", "1.0.1-rc.1"],
    ["1.0.0+build5", "1.0.1"],
    [">= 2.0, < 3.0", ">= 2.1, < 4.0"],
    ["8f4b7f84864484a7bf31766abe9204da3cbe65b3", "11bd71901bbe5b1630ceea73d27597364c9af683"],
    ["main", "master"],
  ])("%s → %s is unknown", (from, to) => {
    expect(bump(from, to)).toBe("unknown");
  });
});

describe("isSecurityUpdate", () => {
  it.each([
    "**Vulnerabilities fixed** in this release",
    "This is a security update for your repository",
    "Fixes CVE-2024-12345",
    "See GHSA-abcd-1234-wxyz for details",
  ])("detects %s", (body) => {
    expect(isSecurityUpdate(body)).toBe(true);
  });

  it("is false for ordinary bodies", () => {
    expect(isSecurityUpdate("Bumps lodash. Release notes: ...")).toBe(false);
    expect(isSecurityUpdate(null)).toBe(false);
    expect(isSecurityUpdate("")).toBe(false);
  });
});

describe("isDependabotBranch", () => {
  it("accepts dependabot branch prefixes only", () => {
    expect(isDependabotBranch("dependabot/npm_and_yarn/lodash-4.17.21")).toBe(true);
    expect(isDependabotBranch("feature/dependabot")).toBe(false);
    expect(isDependabotBranch("main")).toBe(false);
  });
});
