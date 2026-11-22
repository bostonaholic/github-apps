import { describe, expect, it } from "vitest";
import { buildFooter } from "../src/build.js";

describe("buildFooter", () => {
  it("names the version and the short SHA", () => {
    expect(buildFooter("1.2.3", "abc1234def5678")).toBe("<sub>merge-warden v1.2.3 · abc1234</sub>");
  });

  it("names only the version when the SHA is unknown", () => {
    expect(buildFooter("1.2.3", undefined)).toBe("<sub>merge-warden v1.2.3</sub>");
  });
});
