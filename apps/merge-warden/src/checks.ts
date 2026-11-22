// I/O: one verdict over every check run and commit status on a commit.
//
// Adapted from dependabot-shepherd's checksRollup
// (apps/dependabot-shepherd/src/shepherd.ts). Kept as a copy: the two
// differ in three behaviors (below), and apps in this repo share no code.
// - This app's own check run is skipped, by app id. It is the verdict,
//   not CI, and while in progress it would hold the rollup at pending.
// - Green needs every check named in the repo's `ci_checks` to have
//   succeeded. A success from any other source (a deploy preview, a
//   status bot) says nothing about tests, so it never makes green. With
//   no names configured the rollup is never green.
// - No lookup of workflow files: with the rule above it is not needed.

import type { Context } from "probot";

type Octokit = Context["octokit"];

export type Rollup = "green" | "pending" | "red";

// Skipped is not a failure: a job skipped by `if:` did not fail. Neutral
// is the same idea for checks that ran without a pass/fail verdict.
const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

// The combined-status endpoint defaults to 30 per page and is not a
// Link-header list, so octokit.paginate will not walk it. Fetch every page.
const STATUS_PAGE_SIZE = 100;

interface RefParams {
  owner: string;
  repo: string;
  ref: string;
}

async function listCombinedStatuses(octokit: Octokit, { owner, repo, ref }: RefParams) {
  const statuses = [];
  for (let page = 1; ; page++) {
    const { data } = await octokit.rest.repos.getCombinedStatusForRef({
      owner,
      repo,
      ref,
      per_page: STATUS_PAGE_SIZE,
      page,
    });
    statuses.push(...data.statuses);
    if (data.statuses.length < STATUS_PAGE_SIZE || statuses.length >= data.total_count) {
      return statuses;
    }
  }
}

export async function checksRollup(
  octokit: Octokit,
  { owner, repo, ref, appId, ciChecks }: RefParams & {
    appId: number;
    // Check-run names or commit-status contexts that count as CI.
    ciChecks: string[];
  },
): Promise<Rollup> {
  const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
    owner,
    repo,
    ref,
    per_page: 100,
  });

  let pending = false;
  const succeeded = new Set<string>();
  for (const run of runs) {
    if (run.app?.id === appId) continue;
    if (run.status !== "completed") {
      pending = true;
      continue;
    }
    if (!PASSING_CONCLUSIONS.has(run.conclusion ?? "")) return "red";
    if (run.conclusion === "success") succeeded.add(run.name);
  }

  for (const status of await listCombinedStatuses(octokit, { owner, repo, ref })) {
    if (status.state === "pending") pending = true;
    else if (status.state !== "success") return "red";
    else succeeded.add(status.context);
  }

  // Anything failing is red and anything running is pending, whatever
  // its name. Only green is limited to the named checks.
  if (pending) return "pending";
  const ciPassed = ciChecks.length > 0 && ciChecks.every((name) => succeeded.has(name));
  return ciPassed ? "green" : "pending";
}
