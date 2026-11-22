import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../src/config.js";

describe("normalizeConfig", () => {
  it("defaults when no config file exists: owner is the only author", () => {
    expect(normalizeConfig(null, "Octocat")).toEqual({
      enabled: true,
      authors: ["octocat"],
      merge_method: "squash",
      one_way_door_paths: [],
      high_risk_paths: [],
      ci_checks: [],
    });
  });

  it("reads ci_checks as a list of names, empty when absent or malformed", () => {
    expect(normalizeConfig({ ci_checks: ["test", "lint"] }, "o").ci_checks).toEqual([
      "test",
      "lint",
    ]);
    expect(normalizeConfig({ ci_checks: "test" }, "o").ci_checks).toEqual(["test"]);
    expect(normalizeConfig({ ci_checks: 3 }, "o").ci_checks).toEqual([]);
    expect(normalizeConfig({}, "o").ci_checks).toEqual([]);
  });

  it("honors an explicit enabled: false", () => {
    expect(normalizeConfig({ enabled: false }, "o").enabled).toBe(false);
  });

  it("treats a non-boolean enabled as enabled", () => {
    expect(normalizeConfig({ enabled: "nope" }, "o").enabled).toBe(true);
  });

  it("lowercases configured authors and replaces the owner default", () => {
    expect(normalizeConfig({ authors: ["Alice", "bob"] }, "o").authors).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("accepts a bare string as a one-entry list", () => {
    expect(normalizeConfig({ authors: "alice" }, "o").authors).toEqual(["alice"]);
    expect(
      normalizeConfig({ one_way_door_paths: "db/**" }, "o").one_way_door_paths,
    ).toEqual(["db/**"]);
  });

  it("makes a malformed authors value nobody, not the owner", () => {
    expect(normalizeConfig({ authors: 42 }, "o").authors).toEqual([]);
    expect(normalizeConfig({ authors: { a: 1 } }, "o").authors).toEqual([]);
  });

  it("keeps an explicit empty authors list empty", () => {
    expect(normalizeConfig({ authors: [] }, "o").authors).toEqual([]);
  });

  it("falls back to squash for an invalid merge method", () => {
    expect(normalizeConfig({ merge_method: "octopus" }, "o").merge_method).toBe(
      "squash",
    );
    expect(normalizeConfig({ merge_method: "rebase" }, "o").merge_method).toBe(
      "rebase",
    );
  });

  it("drops non-string and empty path entries", () => {
    const config = normalizeConfig(
      { one_way_door_paths: ["db/**", 7, "", null], high_risk_paths: ["infra/**"] },
      "o",
    );
    expect(config.one_way_door_paths).toEqual(["db/**"]);
    expect(config.high_risk_paths).toEqual(["infra/**"]);
  });
});
