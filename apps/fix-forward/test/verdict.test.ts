import { describe, expect, it } from "vitest";
import { commitVerdict, flakeReruns, latestRuns, type CheckRun } from "../src/verdict.js";

const ACTIONS = { id: 1, slug: "github-actions" };
const OTHER = { id: 2, slug: "other-ci" };

function run(name: string, conclusion: string | null, extra: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 1,
    name,
    status: conclusion === null ? "in_progress" : "completed",
    conclusion,
    app: ACTIONS,
    check_suite: { id: 77 },
    html_url: `https://ci/${name}`,
    ...extra,
  };
}

describe("latestRuns", () => {
  it("keeps the newest run per app and name", () => {
    const runs = [run("test", "failure", { id: 1 }), run("test", "success", { id: 2 }), run("test", "failure", { id: 3, app: OTHER })];
    expect(latestRuns(runs).map((r) => r.id)).toEqual([2, 3]);
  });
});

describe("commitVerdict", () => {
  it("is green when every named check succeeded", () => {
    expect(commitVerdict([run("test", "success")], [{ context: "lint", state: "success" }], ["test", "lint"])).toEqual({ kind: "green" });
  });

  it("is red with an Actions failure carrying its job and check suite", () => {
    expect(commitVerdict([run("test", "failure", { id: 9 })], [], ["test"])).toEqual({
      kind: "red",
      failures: [{ name: "test", url: "https://ci/test", jobId: 9, checkSuiteId: 77 }],
    });
  });

  it("is red with a failed status or non-Actions run carrying no job", () => {
    const verdict = commitVerdict(
      [run("e2e", "timed_out", { app: OTHER })],
      [{ context: "lint", state: "error", target_url: "https://lint" }],
      ["e2e", "lint"],
    );
    expect(verdict).toEqual({
      kind: "red",
      failures: [
        { name: "e2e", url: "https://ci/e2e", jobId: null, checkSuiteId: null },
        { name: "lint", url: "https://lint", jobId: null, checkSuiteId: null },
      ],
    });
  });

  it("ignores failures of checks the repo did not name", () => {
    expect(commitVerdict([run("deploy-preview", "failure"), run("test", "success")], [], ["test"])).toEqual({ kind: "green" });
  });

  it("is pending while a named check runs, is skipped, or has not reported", () => {
    expect(commitVerdict([run("test", null)], [], ["test"]).kind).toBe("pending");
    expect(commitVerdict([run("test", "skipped")], [], ["test"]).kind).toBe("pending");
    expect(commitVerdict([], [{ context: "test", state: "pending" }], ["test"]).kind).toBe("pending");
    expect(commitVerdict([run("test", "success")], [], ["test", "lint"]).kind).toBe("pending");
  });

  it("judges a re-run by its newest run", () => {
    expect(commitVerdict([run("test", "failure", { id: 1 }), run("test", null, { id: 2 })], [], ["test"]).kind).toBe("pending");
  });

  it("is never green with no named checks", () => {
    expect(commitVerdict([run("test", "success")], [], []).kind).toBe("pending");
  });
});

describe("flakeReruns", () => {
  const failure = { name: "test", url: null, jobId: 9, checkSuiteId: 77 };

  it("re-runs a workflow run on its first attempt, once per run", () => {
    expect(flakeReruns([failure, { ...failure, jobId: 10 }], [{ id: 5, check_suite_id: 77, run_attempt: 1 }])).toEqual([5]);
  });

  it("does not re-run a workflow run already re-run", () => {
    expect(flakeReruns([failure], [{ id: 5, check_suite_id: 77, run_attempt: 2 }])).toEqual([]);
  });

  it("cannot re-run a status, a non-Actions run, or a run it cannot find", () => {
    expect(flakeReruns([{ ...failure, checkSuiteId: null, jobId: null }], [{ id: 5, check_suite_id: 77, run_attempt: 1 }])).toEqual([]);
    expect(flakeReruns([failure], [])).toEqual([]);
  });
});
