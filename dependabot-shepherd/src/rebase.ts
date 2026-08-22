// Orchestration: after the default branch moves, ask Dependabot to rebase
// its open PRs that fell behind or conflicted — at most once per head
// commit, so repeated pushes don't spam while Dependabot is working.

import type { Context } from "probot";
import { DEPENDABOT_LOGIN, isDependabotBranch } from "./parse.js";
import { IGNORE_LABEL, shouldRequestRebase, type ShepherdConfig } from "./policy.js";
import type { Logger } from "./shepherd.js";

type Octokit = Context["octokit"];

export const REBASE_COMMAND = "@dependabot rebase";

const NOOP_LOG: Logger = { info() {}, warn() {}, error() {} };

export interface RebaseParams {
  owner: string;
  repo: string;
  config: ShepherdConfig;
  // e2e seam, as in shepherd.ts. Never set in production.
  allowAuthor?: string;
  log?: Logger;
}

export async function rebaseStalePRs(
  octokit: Octokit,
  params: RebaseParams,
): Promise<void> {
  const { owner, repo, config } = params;
  const log = params.log ?? NOOP_LOG;
  if (!config.enabled || !config.rebase) return;

  const prs = await octokit.paginate(octokit.rest.pulls.list, {
    owner,
    repo,
    state: "open",
    per_page: 100,
  });

  for (const item of prs) {
    const isDependabot =
      item.user?.login === DEPENDABOT_LOGIN && item.user?.type === "Bot";
    const isAllowed =
      params.allowAuthor !== undefined && item.user?.login === params.allowAuthor;
    if ((!isDependabot && !isAllowed) || !isDependabotBranch(item.head.ref)) continue;
    if (item.draft) continue;
    if (item.labels.some((label) => label.name === IGNORE_LABEL)) continue;

    // mergeable_state is only present on a full get.
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: item.number,
    });
    if (pr.mergeable_state !== "behind" && pr.mergeable_state !== "dirty") continue;

    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: item.number,
      per_page: 100,
    });
    const lastRebase = [...comments]
      .reverse()
      .find(
        (comment) =>
          comment.user?.type === "Bot" &&
          (comment.body ?? "").includes(REBASE_COMMAND),
      );

    // The commit date is only needed to decide whether an earlier rebase
    // request already covers the current head.
    let headCommittedAt: string | null = null;
    if (lastRebase) {
      const { data: commit } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: pr.head.sha,
      });
      headCommittedAt = commit.commit.committer?.date ?? null;
    }

    const wanted = shouldRequestRebase({
      mergeableState: pr.mergeable_state,
      lastRebaseCommentAt: lastRebase?.created_at ?? null,
      headCommittedAt,
    });
    if (!wanted) continue;

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: item.number,
      body: REBASE_COMMAND,
    });
    log.info(`${owner}/${repo}#${item.number}: requested rebase (${pr.mergeable_state})`);
  }
}
