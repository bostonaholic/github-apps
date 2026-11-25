// I/O: `reconcile()`, the single orchestration entry point. Every event
// re-reads the default branch's history and the app's streak issues and
// converges on them, so webhook order and redelivery do not matter. The
// marker in each streak issue's body is the only stored state.

import type { Context } from "probot";
import { checkCommit, type CommitCheck } from "./checks.js";
import type { AppConfig } from "./config.js";
import { readHistory, walkDone, type BranchState, type CommitEntry } from "./history.js";
import {
  closeStreakIssue,
  listStreakIssues,
  openStreakIssue,
  triggerAgentOnce,
  updateStreakIssue,
} from "./issues.js";
import { failureReports } from "./logs.js";
import {
  agentComment,
  appendToBody,
  fixedComment,
  issueBody,
  issueTitle,
  supersededComment,
  type CommitReport,
  type Culprit,
} from "./report.js";

type Octokit = Context["octokit"];

// Commits walked back from the branch head looking for the last green one.
export const HISTORY_LIMIT = 100;

interface Log {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}

export interface ReconcileParams {
  owner: string;
  repo: string;
  repoUrl: string;
  defaultBranch: string;
  // Branches the event's commit is on. The app acts only for the default.
  eventBranches: string[];
  config: AppConfig;
  botLogin: string;
  log: Log;
}

export async function reconcile(octokit: Octokit, params: ReconcileParams): Promise<void> {
  const { owner, repo, repoUrl, defaultBranch, config, botLogin, log } = params;
  if (!config.enabled || config.ci_checks.length === 0) return;
  if (!params.eventBranches.includes(defaultBranch)) return;

  const issues = await listStreakIssues(octokit, { owner, repo, botLogin });
  const open = issues.find((issue) => issue.open);
  const { state, checks } = await walk(octokit, {
    owner,
    repo,
    branch: defaultBranch,
    ciChecks: config.ci_checks,
    wantFixing: open !== undefined,
  });

  if (state.state === "unknown") return;
  if (state.state === "green") {
    if (!open) return;
    await closeStreakIssue(octokit, {
      owner,
      repo,
      issue_number: open.number,
      comment: fixedComment(repoUrl, state.fixing),
    });
    log.info({ issue: open.number, fixing: state.fixing }, "fix-forward: streak fixed");
    return;
  }

  // The newest issue belongs to this streak when it names the same last
  // green commit. With no green commit in the walked history, the newest
  // issue is taken as this streak's.
  const latest = issues[0];
  const sameStreak =
    latest !== undefined && (latest.marker.base === state.base || state.base === null);

  // A person closed this streak's issue: the streak is over for the app
  // until the branch is green again.
  if (sameStreak && !latest.open) return;

  await rerunFlakes(octokit, { owner, repo, state, checks, log });
  const reports = (shas: string[]) =>
    commitReports(octokit, { owner, repo, shas, checks, logLines: config.log_lines, log });

  if (!sameStreak) {
    // An open issue from an older streak: the branch was green at this
    // streak's base since, so that streak is over.
    if (open && state.base !== null) {
      await closeStreakIssue(octokit, {
        owner,
        repo,
        issue_number: open.number,
        comment: supersededComment(repoUrl, state.base),
      });
    }
    // Only unconfirmed failures so far: their re-runs decide.
    if (state.reds.length === 0) return;
    const culprit =
      state.base === null
        ? null
        : await findCulprit(octokit, { owner, repo, sha: state.reds[0]!, defaultBranch });
    const facts = { repoUrl, branch: defaultBranch, base: state.base, range: state.range, culprit };
    const issue_number = await openStreakIssue(octokit, {
      owner,
      repo,
      title: issueTitle(defaultBranch, culprit),
      body: issueBody(facts, await reports(state.reds)),
    });
    log.info({ issue: issue_number, culprit: culprit?.sha ?? null }, "fix-forward: streak opened");
    await triggerAgent(octokit, { owner, repo, issue_number, botLogin, config });
    return;
  }

  const fresh = state.reds.filter((sha) => !latest.marker.reported.includes(sha));
  if (fresh.length > 0) {
    await updateStreakIssue(octokit, {
      owner,
      repo,
      issue_number: latest.number,
      body: appendToBody(latest.body, repoUrl, latest.marker, await reports(fresh)),
    });
    log.info({ issue: latest.number, commits: fresh }, "fix-forward: failures appended");
  }
  // Also covers a run that opened the issue and stopped before commenting.
  await triggerAgent(octokit, { owner, repo, issue_number: latest.number, botLogin, config });
}

async function walk(
  octokit: Octokit,
  { owner, repo, branch, ciChecks, wantFixing }: {
    owner: string;
    repo: string;
    branch: string;
    ciChecks: string[];
    wantFixing: boolean;
  },
): Promise<{ state: BranchState; checks: Map<string, CommitCheck> }> {
  const { data: commits } = await octokit.rest.repos.listCommits({
    owner,
    repo,
    sha: branch,
    per_page: HISTORY_LIMIT,
  });
  const entries: CommitEntry[] = [];
  const checks = new Map<string, CommitCheck>();
  for (const { sha } of commits) {
    const check = await checkCommit(octokit, { owner, repo, sha, ciChecks });
    entries.push(check.entry);
    checks.set(sha, check);
    if (walkDone(entries, wantFixing)) break;
  }
  return { state: readHistory(entries), checks };
}

// Each red commit in the streak gets its failed Actions jobs re-run once.
// A re-run makes the commit's checks pending, so the next event sees the
// result rather than re-running again.
async function rerunFlakes(
  octokit: Octokit,
  { owner, repo, state, checks, log }: {
    owner: string;
    repo: string;
    state: Extract<BranchState, { state: "red" }>;
    checks: Map<string, CommitCheck>;
    log: Log;
  },
): Promise<void> {
  for (const sha of state.range) {
    for (const run_id of checks.get(sha)?.reruns ?? []) {
      await octokit.rest.actions.reRunWorkflowFailedJobs({ owner, repo, run_id });
      log.info({ sha, run_id }, "fix-forward: re-ran failed jobs");
    }
  }
}

async function commitReports(
  octokit: Octokit,
  { owner, repo, shas, checks, logLines, log }: {
    owner: string;
    repo: string;
    shas: string[];
    checks: Map<string, CommitCheck>;
    logLines: number;
    log: Log;
  },
): Promise<CommitReport[]> {
  const reports: CommitReport[] = [];
  for (const sha of shas) {
    const failures = checks.get(sha)?.failures ?? [];
    reports.push({
      sha,
      failures: await failureReports(octokit, { owner, repo, failures, logLines, log }),
    });
  }
  return reports;
}

// The pull request merged as `sha` into the default branch. None for a
// direct push.
async function findCulprit(
  octokit: Octokit,
  { owner, repo, sha, defaultBranch }: { owner: string; repo: string; sha: string; defaultBranch: string },
): Promise<Culprit | null> {
  const { data: prs } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
    owner,
    repo,
    commit_sha: sha,
  });
  const pr = prs.find(
    (p) => p.merged_at && p.merge_commit_sha === sha && p.base.ref === defaultBranch,
  );
  return pr ? { sha, pr: { number: pr.number, title: pr.title, url: pr.html_url } } : null;
}

async function triggerAgent(
  octokit: Octokit,
  { owner, repo, issue_number, botLogin, config }: {
    owner: string;
    repo: string;
    issue_number: number;
    botLogin: string;
    config: AppConfig;
  },
): Promise<void> {
  await triggerAgentOnce(octokit, {
    owner,
    repo,
    issue_number,
    botLogin,
    body: agentComment(config.agent_handle),
  });
}
