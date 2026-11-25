import { describe, expect, it } from "vitest";
import { readHistory, walkDone, type CommitEntry } from "../src/history.js";

const green = (sha: string): CommitEntry => ({ sha, verdict: "green", confirmed: true });
const red = (sha: string, confirmed = true): CommitEntry => ({ sha, verdict: "red", confirmed });
const pending = (sha: string): CommitEntry => ({ sha, verdict: "pending", confirmed: true });

describe("walkDone", () => {
  it("keeps walking past pending commits", () => {
    expect(walkDone([pending("c")], false)).toBe(false);
  });

  it("stops at a green head unless the fixing commit is wanted", () => {
    expect(walkDone([green("c")], false)).toBe(true);
    expect(walkDone([green("c")], true)).toBe(false);
    expect(walkDone([green("c"), red("b")], true)).toBe(true);
  });

  it("walks a red head back to the last green commit", () => {
    expect(walkDone([red("c"), red("b")], false)).toBe(false);
    expect(walkDone([red("c"), pending("b"), green("a")], false)).toBe(true);
  });
});

describe("readHistory", () => {
  it("is unknown when nothing settled", () => {
    expect(readHistory([pending("b"), pending("a")])).toEqual({ state: "unknown" });
  });

  it("names the oldest green commit after the last red one as the fix", () => {
    expect(readHistory([pending("e"), green("d"), green("c"), red("b"), green("a")])).toEqual({ state: "green", fixing: "c" });
  });

  it("reads a red streak back to its base, oldest first", () => {
    expect(readHistory([red("d"), pending("c"), red("b"), green("a")])).toEqual({
      state: "red",
      base: "a",
      range: ["b", "c", "d"],
      reds: ["b", "d"],
    });
  });

  it("leaves unconfirmed red commits out of reds", () => {
    expect(readHistory([red("c", false), red("b"), green("a")])).toMatchObject({ reds: ["b"] });
  });

  it("has a null base when no green commit was walked", () => {
    expect(readHistory([red("b"), red("a")])).toEqual({ state: "red", base: null, range: ["a", "b"], reds: ["a", "b"] });
  });
});
