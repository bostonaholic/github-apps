import { describe, expect, it } from "vitest";
import { failureReports } from "../src/logs.js";
import { actionsRun, fakeGitHub, silentLog } from "./fake-github.js";

describe("failureReports", () => {
  it("quotes the failing step's log tail for an Actions job", async () => {
    const fake = fakeGitHub();
    const run = actionsRun(fake.state, "c1", "test", "failure");
    const reports = await failureReports(fake.octokit, {
      owner: "o",
      repo: "r",
      failures: [{ name: "test", url: "u", jobId: run.id, checkSuiteId: run.check_suite.id }],
      logLines: 50,
      log: silentLog,
    });
    expect(reports).toEqual([
      {
        name: "test",
        url: "u",
        log: { job: "test", step: "Run tests", lines: ["running tests", "FAIL expected 1 to be 2"] },
        note: null,
      },
    ]);
  });

  it("notes a check with no log, and a log that cannot be fetched, without throwing", async () => {
    const fake = fakeGitHub();
    const run = actionsRun(fake.state, "c1", "test", "failure");
    delete fake.state.logs[run.id];
    const warnings: string[] = [];
    const reports = await failureReports(fake.octokit, {
      owner: "o",
      repo: "r",
      failures: [
        { name: "lint", url: null, jobId: null, checkSuiteId: null },
        { name: "test", url: null, jobId: run.id, checkSuiteId: run.check_suite.id },
      ],
      logLines: 50,
      log: { warn: (_obj, msg) => warnings.push(msg) },
    });
    expect(reports.map((r) => r.note)).toEqual(["Not a GitHub Actions check, so no log.", "Log unavailable: Gone."]);
    expect(warnings).toHaveLength(1);
  });
});
