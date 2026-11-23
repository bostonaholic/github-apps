import { describe, expect, it } from "vitest";
import { buildFooter } from "../src/build.js";

describe("buildFooter", () => {
  it("names the version and the short SHA", () => {
    expect(buildFooter("1.2.3", "abc1234def5678", null)).toBe(
      "<sub>merge-warden v1.2.3 · abc1234</sub>",
    );
  });

  it("names only the version when the SHA is unknown", () => {
    expect(buildFooter("1.2.3", undefined, null)).toBe("<sub>merge-warden v1.2.3</sub>");
  });

  it("names the model that graded the diff", () => {
    expect(buildFooter("1.2.3", "abc1234def5678", "claude-haiku-5-5")).toBe(
      "<sub>merge-warden v1.2.3 · abc1234 · graded by claude-haiku-5-5</sub>",
    );
  });
});
