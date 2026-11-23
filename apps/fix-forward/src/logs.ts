// I/O: one report per failing check, with the failing step's log tail
// for GitHub Actions jobs. A log that cannot be fetched becomes a note in
// the report; it never stops the issue from being written.

import type { Context } from "probot";
import { stepLogTail, type FailureReport } from "./report.js";
import type { Failure } from "./verdict.js";

type Octokit = Context["octokit"];

interface Log {
  warn: (obj: object, msg: string) => void;
}

export async function failureReports(
  octokit: Octokit,
  { owner, repo, failures, logLines, log }: {
    owner: string;
    repo: string;
    failures: readonly Failure[];
    logLines: number;
    log: Log;
  },
): Promise<FailureReport[]> {
  const reports: FailureReport[] = [];
  for (const failure of failures) {
    const base = { name: failure.name, url: failure.url };
    if (failure.jobId === null) {
      reports.push({ ...base, log: null, note: "Not a GitHub Actions check, so no log." });
      continue;
    }
    try {
      reports.push({
        ...base,
        log: await jobLog(octokit, { owner, repo, job_id: failure.jobId, logLines }),
        note: null,
      });
    } catch (error) {
      log.warn({ err: error, job_id: failure.jobId }, "fix-forward: job log unavailable");
      reports.push({ ...base, log: null, note: `Log unavailable: ${message(error)}.` });
    }
  }
  return reports;
}

async function jobLog(
  octokit: Octokit,
  { owner, repo, job_id, logLines }: { owner: string; repo: string; job_id: number; logLines: number },
) {
  const { data: job } = await octokit.rest.actions.getJobForWorkflowRun({ owner, repo, job_id });
  const step = (job.steps ?? []).find((s) => s.conclusion === "failure") ?? null;
  // GitHub answers with a redirect to the plain-text log; octokit follows it.
  const { data: text } = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
    owner,
    repo,
    job_id,
  });
  return {
    job: job.name,
    step: step?.name ?? null,
    lines: stepLogTail(String(text), step, logLines),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
