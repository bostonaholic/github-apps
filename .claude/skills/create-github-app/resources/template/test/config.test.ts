import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../src/config.js";

describe("normalizeConfig", () => {
  it("defaults when no config file exists", () => {
    expect(normalizeConfig(null)).toEqual({ enabled: true });
  });

  it("honors an explicit enabled: false", () => {
    expect(normalizeConfig({ enabled: false })).toEqual({ enabled: false });
  });

  it("ignores non-boolean values", () => {
    expect(normalizeConfig({ enabled: "nope" })).toEqual({ enabled: true });
  });
});
