// I/O: read one commit's check runs, commit statuses, and (when an
// Actions job failed) its workflow runs, and reduce them with verdict.ts.

import type { Context } from "probot";
import { commitVerdict, flakeReruns, type Failure } from "./verdict.js";
import type { CommitEntry } from "./history.js";

type Octokit = Context["octokit"];

// The combined-status endpoint defaults to 30 per page and is not a
// Link-header list, so octokit.paginate will not walk it.
const STATUS_PAGE_SIZE = 100;

interface RefParams {
  owner: string;
  repo: string;
  sha: string;
}

export interface CommitCheck {
  entry: CommitEntry;
  failures: Failure[];
  // Workflow runs still owed their one flake re-run.
  reruns: number[];
}

export async function checkCommit(
  octokit: Octokit,
  { owner, repo, sha, ciChecks }: RefParams & { ciChecks: string[] },
): Promise<CommitCheck> {
  const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
    owner,
    repo,
    ref: sha,
    per_page: 100,
  });
  const statuses = await listCombinedStatuses(octokit, { owner, repo, sha });
  const verdict = commitVerdict(runs, statuses, ciChecks);
  if (verdict.kind !== "red") {
    return { entry: { sha, verdict: verdict.kind, confirmed: true }, failures: [], reruns: [] };
  }

  let reruns: number[] = [];
  if (verdict.failures.some((f) => f.checkSuiteId !== null)) {
    const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      head_sha: sha,
      per_page: 100,
    });
    reruns = flakeReruns(verdict.failures, data.workflow_runs);
  }
  return {
    entry: { sha, verdict: "red", confirmed: reruns.length === 0 },
    failures: verdict.failures,
    reruns,
  };
}

async function listCombinedStatuses(octokit: Octokit, { owner, repo, sha }: RefParams) {
  const statuses = [];
  for (let page = 1; ; page++) {
    const { data } = await octokit.rest.repos.getCombinedStatusForRef({
      owner,
      repo,
      ref: sha,
      per_page: STATUS_PAGE_SIZE,
      page,
    });
    statuses.push(...data.statuses);
    if (data.statuses.length < STATUS_PAGE_SIZE || statuses.length >= data.total_count) {
      return statuses;
    }
  }
}
