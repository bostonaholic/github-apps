// I/O: GitHub's native auto-merge. Arm it, disarm it, and decide whether
// arming is safe on a branch.
//
// GitHub keeps auto-merge armed across pushes by anyone with write access.
// On a branch that does not require this app's check, a new commit could
// merge before the app has graded it. So the app arms auto-merge only
// where its own check is required, and merges directly everywhere else.

import type { Context } from "probot";
import type { MergeMethod } from "./config.js";

type Octokit = Context["octokit"];

// "method" is reserved by octokit's graphql() as a request option, so the
// variable must be named something else.
const ENABLE_AUTO_MERGE = `
  mutation($id: ID!, $mergeMethod: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID!) {
    enablePullRequestAutoMerge(
      input: { pullRequestId: $id, mergeMethod: $mergeMethod, expectedHeadOid: $expectedHeadOid }
    ) {
      clientMutationId
    }
  }
`;

const DISABLE_AUTO_MERGE = `
  mutation($id: ID!) {
    disablePullRequestAutoMerge(input: { pullRequestId: $id }) {
      clientMutationId
    }
  }
`;

const GRAPHQL_METHOD: Record<MergeMethod, string> = {
  squash: "SQUASH",
  merge: "MERGE",
  rebase: "REBASE",
};

// armed:  GitHub will merge when the branch's requirements pass.
// direct: GitHub declined; the caller merges directly instead.
export type ArmOutcome = { armed: true } | { armed: false; why: string };

// Arm auto-merge for exactly one commit. Every refusal routes to the
// direct path, which merges only on a green rollup with a pinned commit,
// so no refusal needs its own handling. Known refusals: the pull request
// is already mergeable ("clean status"), has a failing or pending
// non-required check ("unstable status"), or the repository has
// auto-merge switched off.
export async function armAutoMerge(
  octokit: Octokit,
  params: { pullRequestId: string; mergeMethod: MergeMethod; head: string },
): Promise<ArmOutcome> {
  try {
    await octokit.graphql(ENABLE_AUTO_MERGE, {
      id: params.pullRequestId,
      mergeMethod: GRAPHQL_METHOD[params.mergeMethod],
      // GitHub refuses if the head is no longer the graded commit.
      expectedHeadOid: params.head,
    });
    return { armed: true };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    if (/already\s+enabled/i.test(why)) return { armed: true };
    return { armed: false, why };
  }
}

// Throws on failure. The caller must not go on to publish a verdict or
// call the model while auto-merge may still be armed.
export async function disarmAutoMerge(
  octokit: Octokit,
  pullRequestId: string,
): Promise<void> {
  await octokit.graphql(DISABLE_AUTO_MERGE, { id: pullRequestId });
}

// True when branch protection requires a status check with this name
// reported by this app. A requirement that accepts the name from any
// source does not count: another app could satisfy it for a commit this
// app has not graded. Requirements set through rulesets are not read
// here; such branches take the direct path.
export async function requiresOwnCheck(
  octokit: Octokit,
  params: { owner: string; repo: string; branch: string; checkName: string; appId: number },
): Promise<boolean> {
  const { data } = await octokit.rest.repos.getBranch({
    owner: params.owner,
    repo: params.repo,
    branch: params.branch,
  });
  const checks = data.protection?.required_status_checks?.checks ?? [];
  return checks.some(
    (check) => check.context === params.checkName && check.app_id === params.appId,
  );
}
