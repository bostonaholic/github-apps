// Orchestration: decide whether a Dependabot PR may merge and drive it
// there — approve once per head commit, enable native auto-merge, or fall
// back to merging directly once checks are green on repos where
// auto-merge cannot be enabled. Idempotent: every webhook re-enters here
// and re-running always converges.

import type { Context } from "probot";
import {
  DEPENDABOT_LOGIN,
  isDependabotBranch,
  isSecurityUpdate,
  parseUpdates,
} from "./parse.js";
import {
  decide,
  hasChangesRequested,
  isApprovedAtHead,
  type ReviewFacts,
  type ShepherdConfig,
} from "./policy.js";

type Octokit = Context["octokit"];

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const NOOP_LOG: Logger = { info() {}, warn() {}, error() {} };

export interface ReconcileParams {
  owner: string;
  repo: string;
  pull_number: number;
  config: ShepherdConfig;
  // e2e seam: one extra author accepted as Dependabot (E2E_ALLOW_AUTHOR).
  // Never set in production.
  allowAuthor?: string;
  log?: Logger;
}

// "method" is reserved by octokit's graphql() as a request option, so the
// variable must be named something else.
const ENABLE_AUTO_MERGE = `
  mutation($id: ID!, $mergeMethod: PullRequestMergeMethod!) {
    enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $mergeMethod }) {
      clientMutationId
    }
  }
`;

export async function reconcile(
  octokit: Octokit,
  params: ReconcileParams,
): Promise<void> {
  const { owner, repo, pull_number, config } = params;
  const log = params.log ?? NOOP_LOG;
  const tag = `${owner}/${repo}#${pull_number}`;

  if (!config.enabled) return;

  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number });
  if (pr.state !== "open") return;

  const isDependabot = pr.user?.login === DEPENDABOT_LOGIN && pr.user?.type === "Bot";
  const isAllowed =
    params.allowAuthor !== undefined && pr.user?.login === params.allowAuthor;
  if ((!isDependabot && !isAllowed) || !isDependabotBranch(pr.head.ref)) return;

  const reviews: ReviewFacts[] = (
    await octokit.paginate(octokit.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number,
      per_page: 100,
    })
  ).map((review) => ({
    userLogin: review.user?.login ?? null,
    state: review.state,
    commitId: review.commit_id ?? null,
  }));

  const facts = {
    updates: parseUpdates(pr.title, pr.body),
    security: isSecurityUpdate(pr.body),
    draft: pr.draft === true,
    labels: pr.labels.map((label) => label.name),
    changesRequested: hasChangesRequested(reviews),
  };

  const decision = decide(facts, config);
  if (!decision.merge) {
    log.warn(`${tag}: not merging — ${decision.reason}`);
    return;
  }

  if (!isApprovedAtHead(reviews, pr.head.sha)) {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      event: "APPROVE",
      body: `Auto-approved by dependabot-shepherd${facts.security ? " (security update)" : ""}: ${decision.reason}`,
    });
  }

  try {
    await octokit.graphql(ENABLE_AUTO_MERGE, {
      id: pr.node_id,
      mergeMethod: config.merge_method.toUpperCase(),
    });
    log.info(`${tag}: auto-merge enabled`);
    return;
  } catch (error) {
    const outcome = classifyAutoMergeError(errorMessage(error));
    if (outcome === "done") {
      log.info(`${tag}: auto-merge already enabled`);
      return;
    }
    if (outcome === "error") {
      log.error(`${tag}: enabling auto-merge failed — ${errorMessage(error)}`);
      return;
    }
    // "fallback": this repo can't use auto-merge; merge directly on green.
  }

  const rollup = await checksRollup(octokit, { owner, repo, ref: pr.head.sha });
  if (rollup === "pending") {
    // A later check_suite/status event re-enters reconcile.
    log.info(`${tag}: checks still running`);
    return;
  }
  if (rollup === "red") {
    log.warn(`${tag}: checks failing; not merging`);
    return;
  }

  try {
    await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number,
      merge_method: config.merge_method,
      // Refuse the merge if the head moved since we looked.
      sha: pr.head.sha,
    });
    log.info(`${tag}: merged (${decision.reason})`);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 405 || status === 409) {
      // Already merged, blocked meanwhile, or the head moved — a later
      // event will reconcile again.
      log.info(`${tag}: merge skipped (${status})`);
      return;
    }
    log.error(`${tag}: merge failed — ${errorMessage(error)}`);
  }
}

type AutoMergeOutcome = "done" | "fallback" | "error";

// The enablePullRequestAutoMerge mutation fails in distinguishable ways:
// "already enabled" means we're done; "clean status" (nothing blocks the
// merge) and "not allowed" (repo has auto-merge switched off / no branch
// protection) mean we must merge directly.
function classifyAutoMergeError(message: string): AutoMergeOutcome {
  if (/already\s+enabled/i.test(message)) return "done";
  if (/clean status|not allowed|auto[- ]?merge is not enabled/i.test(message)) {
    return "fallback";
  }
  return "error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Rollup = "green" | "pending" | "red";

// Combined verdict over check runs and (legacy) commit statuses on a ref.
// No checks and no statuses at all counts as green ONLY on a repo with no
// workflow files: zero-touch on repos without CI is deliberate (see
// README), but right after a PR opens, Actions may not have created its
// check runs yet — merging into that window would bypass CI.
async function checksRollup(
  octokit: Octokit,
  { owner, repo, ref }: { owner: string; repo: string; ref: string },
): Promise<Rollup> {
  const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
    owner,
    repo,
    ref,
    per_page: 100,
  });

  let pending = false;
  for (const run of runs) {
    if (run.status !== "completed") {
      pending = true;
      continue;
    }
    if (!["success", "neutral", "skipped"].includes(run.conclusion ?? "")) {
      return "red";
    }
  }

  const { data: combined } = await octokit.rest.repos.getCombinedStatusForRef({
    owner,
    repo,
    ref,
  });
  if (combined.total_count > 0) {
    if (combined.state === "pending") pending = true;
    else if (combined.state !== "success") return "red";
  }

  if (runs.length === 0 && combined.total_count === 0) {
    // A later check_suite/status event re-enters when CI shows up.
    return (await hasWorkflows(octokit, owner, repo)) ? "pending" : "green";
  }

  return pending ? "pending" : "green";
}

async function hasWorkflows(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<boolean> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: ".github/workflows",
    });
    return (
      Array.isArray(data) &&
      data.some((entry) => /\.ya?ml$/.test(entry.name))
    );
  } catch (error) {
    if ((error as { status?: number }).status === 404) return false;
    throw error;
  }
}
