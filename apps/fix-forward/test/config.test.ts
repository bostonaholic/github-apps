import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_HANDLE, DEFAULT_LOG_LINES, MAX_LOG_LINES, normalizeConfig } from "../src/config.js";

const DEFAULTS = { enabled: true, ci_checks: [], agent_handle: "@claude", log_lines: 50 };

describe("normalizeConfig", () => {
  it("defaults when no config file exists, with no CI checks", () => {
    expect(normalizeConfig(null)).toEqual(DEFAULTS);
    expect(DEFAULT_AGENT_HANDLE).toBe("@claude");
    expect(DEFAULT_LOG_LINES).toBe(50);
  });

  it("honors an explicit enabled: false and ignores non-false values", () => {
    expect(normalizeConfig({ enabled: false }).enabled).toBe(false);
    expect(normalizeConfig({ enabled: "nope" }).enabled).toBe(true);
  });

  it("reads ci_checks as a list or a bare string, dropping junk", () => {
    expect(normalizeConfig({ ci_checks: ["test", "", 3, "lint"] }).ci_checks).toEqual(["test", "lint"]);
    expect(normalizeConfig({ ci_checks: "test" }).ci_checks).toEqual(["test"]);
    expect(normalizeConfig({ ci_checks: { test: true } }).ci_checks).toEqual([]);
  });

  it("adds the @ to a bare handle and accepts a team", () => {
    expect(normalizeConfig({ agent_handle: "codex" }).agent_handle).toBe("@codex");
    expect(normalizeConfig({ agent_handle: "@org/agents" }).agent_handle).toBe("@org/agents");
  });

  it("falls back to the default handle for a malformed one", () => {
    expect(normalizeConfig({ agent_handle: "@claude please" }).agent_handle).toBe("@claude");
    expect(normalizeConfig({ agent_handle: 7 }).agent_handle).toBe("@claude");
  });

  it("clamps log_lines to a positive integer no larger than the max", () => {
    expect(normalizeConfig({ log_lines: 20 }).log_lines).toBe(20);
    expect(normalizeConfig({ log_lines: 10_000 }).log_lines).toBe(MAX_LOG_LINES);
    expect(normalizeConfig({ log_lines: 0 }).log_lines).toBe(50);
    expect(normalizeConfig({ log_lines: 2.5 }).log_lines).toBe(50);
  });
});
