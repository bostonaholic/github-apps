import { describe, expect, it } from "vitest";
import { normalizeConfig, type AppConfig } from "../src/config.js";
import { parseMarker } from "../src/report.js";
import { reconcile } from "../src/reconcile.js";
import { BOT, actionsRun, fakeGitHub, silentLog, type FakeState } from "./fake-github.js";

const PR_TITLE = "Refactor the parser";

function setup(init: Partial<FakeState> = {}) {
  const fake = fakeGitHub(init);
  const deliver = (overrides: { config?: Partial<AppConfig>; branches?: string[] } = {}) =>
    reconcile(fake.octokit, {
      owner: "o",
      repo: "r",
      repoUrl: "https://github.com/o/r",
      defaultBranch: "main",
      eventBranches: overrides.branches ?? ["main"],
      config: { ...normalizeConfig({ ci_checks: ["test"] }), ...overrides.config },
      botLogin: BOT,
      log: silentLog,
    });
  const merged = (sha: string, number: number) => {
    fake.state.prs[sha] = [
      { number, title: PR_TITLE, html_url: `https://github.com/o/r/pull/${number}`, merged_at: "2026-11-22T10:00:00Z", merge_commit_sha: sha, base: { ref: "main" } },
    ];
  };
  // The newest run of a check on a commit settles with this conclusion.
  const settle = (sha: string, name: string, conclusion: string) => {
    const run = fake.state.runs[sha]!.filter((r) => r.name === name).at(-1)!;
    run.status = "completed";
    run.conclusion = conclusion;
  };
  const push = (sha: string) => fake.state.commits.unshift(sha);
  const openIssues = () => fake.state.issues.filter((i) => i.state === "open");
  const agentComments = (n: number) => (fake.state.comments[n] ?? []).filter((c) => c.body.includes("@claude"));
  return { fake, state: fake.state, deliver, merged, settle, push, openIssues, agentComments };
}

// main: g1 green, then c2 merged from PR #2 with its test failing.
function redAfterGreen(attempt = 1) {
  const t = setup({ commits: ["c2", "g1"] });
  actionsRun(t.state, "g1", "test", "success");
  actionsRun(t.state, "c2", "test", "failure", attempt);
  t.merged("c2", 2);
  return t;
}

describe("reconcile: flakes", () => {
  it("re-runs a first failure's Actions jobs once and opens no issue", async () => {
    const t = redAfterGreen();
    await t.deliver();
    expect(t.state.reruns).toHaveLength(1);
    expect(t.state.issues).toEqual([]);
  });

  it("does not re-run again when the same failure is delivered twice", async () => {
    const t = redAfterGreen();
    await t.deliver();
    await t.deliver();
    expect(t.state.reruns).toHaveLength(1);
    expect(t.state.issues).toEqual([]);
  });

  it("opens no issue when the re-run passes", async () => {
    const t = redAfterGreen();
    await t.deliver();
    t.settle("c2", "test", "success");
    await t.deliver();
    expect(t.state.issues).toEqual([]);
    expect(t.state.reruns).toHaveLength(1);
  });

  it("opens one issue when the re-run fails", async () => {
    const t = redAfterGreen();
    await t.deliver();
    t.settle("c2", "test", "failure");
    await t.deliver();
    expect(t.state.reruns).toHaveLength(1);
    expect(t.state.issues).toHaveLength(1);
  });
});

describe("reconcile: opening a streak", () => {
  it("names the culprit PR, merge commit, job, step, and log tail", async () => {
    const t = redAfterGreen(2);
    await t.deliver();
    const [issue] = t.state.issues;
    expect(issue!.title).toBe("main is red: after #2");
    expect(issue!.labels).toEqual([{ name: "main-broken" }]);
    expect(issue!.body).toContain("**Culprit:** #2 `Refactor the parser`, merge commit [`c2`](https://github.com/o/r/commit/c2)");
    expect(issue!.body).toContain("Job `test`, step `Run tests`.");
    expect(issue!.body).toContain("FAIL expected 1 to be 2");
    expect(parseMarker(issue!.body)).toEqual({ base: "g1", reported: ["c2"] });
  });

  it("opens at once for a failure that is not from Actions, with no re-run", async () => {
    const t = setup({ commits: ["c2", "g1"], statuses: { g1: [{ context: "test", state: "success" }], c2: [{ context: "test", state: "failure", target_url: "https://ci/9" }] } });
    await t.deliver();
    expect(t.state.reruns).toEqual([]);
    expect(t.state.issues).toHaveLength(1);
    expect(t.state.issues[0]!.body).toContain("Not a GitHub Actions check, so no log.");
  });

  it("names the first red merge since the last green commit, not the newest", async () => {
    const t = setup({ commits: ["c4", "c3", "g2"] });
    actionsRun(t.state, "g2", "test", "success");
    actionsRun(t.state, "c3", "test", "failure", 2);
    actionsRun(t.state, "c4", "test", "failure", 2);
    t.merged("c3", 3);
    t.merged("c4", 4);
    await t.deliver();
    expect(t.state.issues[0]!.title).toBe("main is red: after #3");
  });

  it("marks the culprit unknown for a direct push, listing the range", async () => {
    const t = redAfterGreen(2);
    t.state.prs = {};
    await t.deliver();
    expect(t.state.issues[0]!.title).toBe("main is red: culprit unknown");
    expect(t.state.issues[0]!.body).toContain("([compare](https://github.com/o/r/compare/g1...c2))");
  });

  it("marks the culprit unknown when no green commit is in history", async () => {
    const t = setup({ commits: ["c2", "c1"] });
    actionsRun(t.state, "c1", "test", "failure", 2);
    actionsRun(t.state, "c2", "test", "failure", 2);
    t.merged("c1", 1);
    await t.deliver();
    const body = t.state.issues[0]!.body;
    expect(t.state.issues[0]!.title).toBe("main is red: culprit unknown");
    expect(body).toContain("No green commit found");
    expect(parseMarker(body)).toEqual({ base: null, reported: ["c1", "c2"] });
  });

  it("triggers the agent exactly once, with the configured handle", async () => {
    const t = redAfterGreen(2);
    await t.deliver({ config: { agent_handle: "@codex" } });
    await t.deliver({ config: { agent_handle: "@codex" } });
    const comments = t.state.comments[1]!;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain("@codex");
  });

  it("ends in the state of one delivery when delivered twice", async () => {
    const t = redAfterGreen(2);
    await t.deliver();
    const once = JSON.stringify({ issues: t.state.issues, comments: t.state.comments, reruns: t.state.reruns });
    await t.deliver();
    expect(JSON.stringify({ issues: t.state.issues, comments: t.state.comments, reruns: t.state.reruns })).toBe(once);
  });
});

describe("reconcile: tracking a streak", () => {
  it("appends new failures to the open issue without a second issue or trigger", async () => {
    const t = redAfterGreen(2);
    await t.deliver();
    t.push("c3");
    actionsRun(t.state, "c3", "test", "failure", 2);
    await t.deliver();
    await t.deliver();
    expect(t.state.issues).toHaveLength(1);
    expect(parseMarker(t.state.issues[0]!.body)).toEqual({ base: "g1", reported: ["c2", "c3"] });
    expect(t.state.issues[0]!.body.match(/### \[`c3`\]/g)).toHaveLength(1);
    expect(t.agentComments(1)).toHaveLength(1);
  });

  it("closes the issue naming the fixing commit when main turns green", async () => {
    const t = redAfterGreen(2);
    await t.deliver();
    t.push("f3");
    actionsRun(t.state, "f3", "test", "success");
    t.push("p4");
    actionsRun(t.state, "p4", "test", null);
    await t.deliver();
    expect(t.openIssues()).toEqual([]);
    expect(t.state.comments[1]!.at(-1)!.body).toContain("[`f3`](https://github.com/o/r/commit/f3)");
  });

  it("lets a manual close end the streak until main is green once", async () => {
    const t = redAfterGreen(2);
    await t.deliver();
    t.state.issues[0]!.state = "closed";
    t.push("c3");
    actionsRun(t.state, "c3", "test", "failure", 1);
    await t.deliver();
    expect(t.state.issues).toHaveLength(1);
    expect(t.state.reruns).toEqual([]);

    t.push("g4");
    actionsRun(t.state, "g4", "test", "success");
    await t.deliver();
    t.push("c5");
    actionsRun(t.state, "c5", "test", "failure", 2);
    t.merged("c5", 5);
    await t.deliver();
    expect(t.state.issues).toHaveLength(2);
    expect(t.state.issues[1]!.title).toBe("main is red: after #5");
    expect(parseMarker(t.state.issues[1]!.body)!.base).toBe("g4");
  });

  it("closes an open issue from an older streak before opening the new one", async () => {
    const t = redAfterGreen(2);
    await t.deliver();
    // The green event for g3 was missed.
    t.push("g3");
    actionsRun(t.state, "g3", "test", "success");
    t.push("c4");
    actionsRun(t.state, "c4", "test", "failure", 2);
    await t.deliver();
    expect(t.state.issues.map((i) => i.state)).toEqual(["closed", "open"]);
    expect(t.state.comments[1]!.at(-1)!.body).toContain("[`g3`]");
  });
});

describe("reconcile: no action", () => {
  it("ignores a failure of a check not in ci_checks", async () => {
    const t = setup({ commits: ["c2", "g1"] });
    actionsRun(t.state, "g1", "test", "success");
    actionsRun(t.state, "c2", "test", "success");
    actionsRun(t.state, "c2", "deploy-preview", "failure");
    await t.deliver();
    expect(t.state.issues).toEqual([]);
    expect(t.state.reruns).toEqual([]);
  });

  it("ignores events for other branches", async () => {
    const t = redAfterGreen(2);
    await t.deliver({ branches: ["feature"] });
    expect(t.state.calls).toEqual([]);
  });

  it("does nothing when disabled or with no ci_checks", async () => {
    const t = redAfterGreen(2);
    await t.deliver({ config: { enabled: false } });
    await t.deliver({ config: { ci_checks: [] } });
    expect(t.state.calls).toEqual([]);
  });

  it("only reads, re-runs jobs, and writes issues", async () => {
    const t = redAfterGreen();
    await t.deliver();
    t.settle("c2", "test", "failure");
    await t.deliver();
    t.push("f3");
    actionsRun(t.state, "f3", "test", "success");
    await t.deliver();
    const writes = t.state.calls.filter((c) => !/\.(list|get)/.test(c));
    expect(new Set(writes)).toEqual(
      new Set(["actions.reRunWorkflowFailedJobs", "actions.downloadJobLogsForWorkflowRun", "issues.createLabel", "issues.create", "issues.createComment", "issues.update"]),
    );
  });
});
