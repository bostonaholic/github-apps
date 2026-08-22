import { describe, expect, it } from "vitest";
import type { Update } from "../src/parse.js";
import {
  ceilingFor,
  decide,
  DEFAULTS,
  hasChangesRequested,
  IGNORE_LABEL,
  isApprovedAtHead,
  normalizeConfig,
  shouldRequestRebase,
  type PrFacts,
} from "../src/policy.js";

const patch: Update = { name: "lodash", from: "4.17.20", to: "4.17.21", bump: "patch" };
const minor: Update = { name: "vitest", from: "3.1.0", to: "3.2.0", bump: "minor" };
const major: Update = { name: "react", from: "18.0.0", to: "19.0.0", bump: "major" };
const unknown: Update = { name: "actions/checkout", from: "abc", to: "def", bump: "unknown" };

function facts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    updates: [patch],
    security: false,
    draft: false,
    labels: [],
    changesRequested: false,
    ...overrides,
  };
}

describe("normalizeConfig", () => {
  it("returns defaults for a missing config", () => {
    expect(normalizeConfig(null)).toEqual(DEFAULTS);
  });

  it("clamps invalid ceilings to none and invalid merge methods to squash", () => {
    const config = normalizeConfig({
      merge: "everything",
      security: "yes",
      merge_method: "fast-forward",
      packages: { "eslint*": "major", react: "nope" },
    });
    expect(config.merge).toBe("none");
    expect(config.security).toBe("none");
    expect(config.merge_method).toBe("squash");
    expect(config.packages).toEqual({ "eslint*": "major", react: "none" });
  });

  it("only an explicit false disables", () => {
    expect(normalizeConfig({ enabled: false }).enabled).toBe(false);
    expect(normalizeConfig({ enabled: "no" }).enabled).toBe(true);
    expect(normalizeConfig({ rebase: false }).rebase).toBe(false);
  });
});

describe("ceilingFor", () => {
  const config = normalizeConfig({
    merge: "minor",
    security: "major",
    packages: { react: "none", "eslint*": "major" },
  });

  it("uses the exact package override first", () => {
    expect(ceilingFor("react", config, false)).toBe("none");
  });

  it("matches trailing-* globs by prefix", () => {
    expect(ceilingFor("eslint-plugin-import", config, false)).toBe("major");
  });

  it("falls back to the global ceiling", () => {
    expect(ceilingFor("lodash", config, false)).toBe("minor");
  });

  it("security raises the ceiling but never lowers it", () => {
    expect(ceilingFor("lodash", config, true)).toBe("major");
    const lowSecurity = normalizeConfig({ merge: "minor", security: "patch" });
    expect(ceilingFor("lodash", lowSecurity, true)).toBe("minor");
  });
});

describe("decide", () => {
  it("merges patch and minor under the default config", () => {
    expect(decide(facts({ updates: [patch, minor] }), DEFAULTS).merge).toBe(true);
  });

  it("never merges majors by default", () => {
    const decision = decide(facts({ updates: [major] }), DEFAULTS);
    expect(decision.merge).toBe(false);
    expect(decision.reason).toContain("react");
    expect(decision.reason).toContain("major");
  });

  it("never merges unknown bumps, even with a major ceiling", () => {
    const config = normalizeConfig({ merge: "major" });
    expect(decide(facts({ updates: [unknown] }), config).merge).toBe(false);
  });

  it("one blocked update blocks the whole group", () => {
    const decision = decide(facts({ updates: [patch, minor, major] }), DEFAULTS);
    expect(decision.merge).toBe(false);
  });

  it("skips when the update could not be parsed", () => {
    const decision = decide(facts({ updates: [] }), DEFAULTS);
    expect(decision.merge).toBe(false);
    expect(decision.reason).toContain("parse");
  });

  it("skips drafts, the ignore label, changes requested, and disabled config", () => {
    expect(decide(facts({ draft: true }), DEFAULTS).merge).toBe(false);
    expect(decide(facts({ labels: [IGNORE_LABEL] }), DEFAULTS).merge).toBe(false);
    expect(decide(facts({ changesRequested: true }), DEFAULTS).merge).toBe(false);
    expect(decide(facts(), normalizeConfig({ enabled: false })).merge).toBe(false);
  });

  it("a security update clears a per-package block when the security ceiling allows it", () => {
    const config = normalizeConfig({ merge: "none", security: "minor" });
    expect(decide(facts({ updates: [minor], security: true }), config).merge).toBe(true);
    expect(decide(facts({ updates: [minor], security: false }), config).merge).toBe(false);
  });
});

describe("hasChangesRequested", () => {
  it("is true while a reviewer's latest verdict is changes requested", () => {
    expect(
      hasChangesRequested([
        { userLogin: "alice", state: "CHANGES_REQUESTED", commitId: "a" },
      ]),
    ).toBe(true);
  });

  it("a later approval by the same reviewer clears it", () => {
    expect(
      hasChangesRequested([
        { userLogin: "alice", state: "CHANGES_REQUESTED", commitId: "a" },
        { userLogin: "alice", state: "APPROVED", commitId: "b" },
      ]),
    ).toBe(false);
  });

  it("commented reviews do not supersede", () => {
    expect(
      hasChangesRequested([
        { userLogin: "alice", state: "CHANGES_REQUESTED", commitId: "a" },
        { userLogin: "alice", state: "COMMENTED", commitId: "b" },
      ]),
    ).toBe(true);
  });
});

describe("isApprovedAtHead", () => {
  it("only counts approvals at the current head sha", () => {
    const reviews = [{ userLogin: "app[bot]", state: "APPROVED", commitId: "old" }];
    expect(isApprovedAtHead(reviews, "old")).toBe(true);
    expect(isApprovedAtHead(reviews, "new")).toBe(false);
  });
});

describe("shouldRequestRebase", () => {
  it("asks for behind and dirty PRs", () => {
    expect(
      shouldRequestRebase({ mergeableState: "behind", lastRebaseCommentAt: null, headCommittedAt: null }),
    ).toBe(true);
    expect(
      shouldRequestRebase({ mergeableState: "dirty", lastRebaseCommentAt: null, headCommittedAt: null }),
    ).toBe(true);
    expect(
      shouldRequestRebase({ mergeableState: "clean", lastRebaseCommentAt: null, headCommittedAt: null }),
    ).toBe(false);
  });

  it("does not ask twice for the same head", () => {
    expect(
      shouldRequestRebase({
        mergeableState: "behind",
        lastRebaseCommentAt: "2026-08-22T10:00:00Z",
        headCommittedAt: "2026-08-22T09:00:00Z",
      }),
    ).toBe(false);
  });

  it("asks again after dependabot pushed a newer head", () => {
    expect(
      shouldRequestRebase({
        mergeableState: "behind",
        lastRebaseCommentAt: "2026-08-22T09:00:00Z",
        headCommittedAt: "2026-08-22T10:00:00Z",
      }),
    ).toBe(true);
  });
});
