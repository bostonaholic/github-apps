import { describe, expect, it } from "vitest";
import { checkCommit } from "../src/checks.js";
import { OTHER_APP, actionsRun, fakeGitHub } from "./fake-github.js";

const check = (fake: ReturnType<typeof fakeGitHub>, ciChecks = ["test"]) =>
  checkCommit(fake.octokit, { owner: "o", repo: "r", sha: "c1", ciChecks });

describe("checkCommit", () => {
  it("is green with no workflow lookup", async () => {
    const fake = fakeGitHub();
    actionsRun(fake.state, "c1", "test", "success");
    expect(await check(fake)).toEqual({
      entry: { sha: "c1", verdict: "green", confirmed: true },
      failures: [],
      reruns: [],
    });
    expect(fake.state.calls).not.toContain("actions.listWorkflowRunsForRepo");
  });

  it("owes a first-attempt Actions failure its re-run", async () => {
    const fake = fakeGitHub();
    actionsRun(fake.state, "c1", "test", "failure");
    const result = await check(fake);
    expect(result.entry).toEqual({ sha: "c1", verdict: "red", confirmed: false });
    expect(result.reruns).toEqual([fake.state.workflowRuns.c1![0]!.id]);
  });

  it("confirms a failure already re-run", async () => {
    const fake = fakeGitHub();
    actionsRun(fake.state, "c1", "test", "failure", 2);
    expect((await check(fake)).entry.confirmed).toBe(true);
  });

  it("confirms a status failure at once", async () => {
    const fake = fakeGitHub({ statuses: { c1: [{ context: "test", state: "failure" }] } });
    const result = await check(fake);
    expect(result.entry).toEqual({ sha: "c1", verdict: "red", confirmed: true });
    expect(fake.state.calls).not.toContain("actions.listWorkflowRunsForRepo");
  });

  it("reads statuses past the first page", async () => {
    const statuses = Array.from({ length: 100 }, (_, i) => ({ context: `bot-${i}`, state: "success" }));
    const fake = fakeGitHub({ statuses: { c1: [...statuses, { context: "test", state: "error" }] } });
    expect((await check(fake)).entry.verdict).toBe("red");
  });

  it("ignores a non-Actions run's failure outside ci_checks", async () => {
    const fake = fakeGitHub();
    actionsRun(fake.state, "c1", "test", "success");
    fake.state.runs.c1!.push({ id: 1, name: "preview", status: "completed", conclusion: "failure", app: OTHER_APP, check_suite: { id: 1 } });
    expect((await check(fake)).entry.verdict).toBe("green");
  });
});
