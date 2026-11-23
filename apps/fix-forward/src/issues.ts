// I/O: the app's streak issues — found by label, author, and marker — and
// every write the app makes to them.

import type { Context } from "probot";
import { AGENT_MARKER, LABEL, parseMarker, type Marker } from "./report.js";

type Octokit = Context["octokit"];

interface RepoParams {
  owner: string;
  repo: string;
}

export interface StreakIssue {
  number: number;
  open: boolean;
  body: string;
  marker: Marker;
}

// The newest issues are enough: only the newest streak issue decides
// anything, and at most one is open.
const ISSUE_PAGE_SIZE = 30;

// This app's streak issues, newest first. An issue someone else opened or
// whose marker was edited away is not one.
export async function listStreakIssues(
  octokit: Octokit,
  { owner, repo, botLogin }: RepoParams & { botLogin: string },
): Promise<StreakIssue[]> {
  const { data } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: LABEL,
    state: "all",
    sort: "created",
    direction: "desc",
    per_page: ISSUE_PAGE_SIZE,
  });
  const issues: StreakIssue[] = [];
  for (const issue of data) {
    if (issue.pull_request || issue.user?.login !== botLogin) continue;
    const marker = parseMarker(issue.body);
    if (!marker) continue;
    issues.push({ number: issue.number, open: issue.state === "open", body: issue.body ?? "", marker });
  }
  return issues;
}

// The label must exist before the issue is created: GitHub drops labels
// it cannot apply, and an unlabeled issue would never be found again.
export async function openStreakIssue(
  octokit: Octokit,
  { owner, repo, title, body }: RepoParams & { title: string; body: string },
): Promise<number> {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: LABEL });
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
    await octokit.rest.issues.createLabel({
      owner,
      repo,
      name: LABEL,
      color: "b60205",
      description: "CI on the default branch is red (fix-forward)",
    });
  }
  const { data } = await octokit.rest.issues.create({ owner, repo, title, body, labels: [LABEL] });
  return data.number;
}

export async function updateStreakIssue(
  octokit: Octokit,
  { owner, repo, issue_number, body }: RepoParams & { issue_number: number; body: string },
): Promise<void> {
  await octokit.rest.issues.update({ owner, repo, issue_number, body });
}

export async function closeStreakIssue(
  octokit: Octokit,
  { owner, repo, issue_number, comment }: RepoParams & { issue_number: number; comment: string },
): Promise<void> {
  await octokit.rest.issues.createComment({ owner, repo, issue_number, body: comment });
  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number,
    state: "closed",
    state_reason: "completed",
  });
}

// Posts the trigger comment unless this app already posted it on the
// issue. Returns whether it posted.
export async function triggerAgentOnce(
  octokit: Octokit,
  { owner, repo, issue_number, botLogin, body }: RepoParams & {
    issue_number: number;
    botLogin: string;
    body: string;
  },
): Promise<boolean> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number,
    per_page: 100,
  });
  const posted = comments.some(
    (c) => c.user?.login === botLogin && (c.body ?? "").includes(AGENT_MARKER),
  );
  if (posted) return false;
  await octokit.rest.issues.createComment({ owner, repo, issue_number, body });
  return true;
}
