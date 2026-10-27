// Orchestration: decide whether a Dependabot PR may merge and drive it
// there — approve once per head commit, then merge directly once every
// check run and status on the head is green. Idempotent: every webhook
// re-enters here and re-running always converges.
//
// Native auto-merge is not used. Org rulesets require "Cursor Security
// Agent: Security Reviewer", that check never runs on Dependabot PRs, and
// GitHub waits for it forever. This app is an always-bypass actor on those
// rulesets, so pulls.merge succeeds without the missing check.

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

// Required by org rulesets and pinned to the Cursor app (integration
// 1210556). It never reports on Dependabot PRs. Ignored in every state so
// a queued or failed placeholder cannot block the merge.
const IGNORED_CHECK_NAMES = new Set(["Cursor Security Agent: Security Reviewer"]);

// Skipped is success: a job skipped by `if:` did not fail. Neutral is the
// same idea for checks that ran without a pass/fail verdict.
const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

function isIgnoredCheck(name: string | undefined): boolean {
  return name !== undefined && IGNORED_CHECK_NAMES.has(name);
}

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
      // Default is squash; a repo config may select merge or rebase.
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
  let sawCheck = false;
  for (const run of runs) {
    if (isIgnoredCheck(run.name)) continue;
    sawCheck = true;
    if (run.status !== "completed") {
      pending = true;
      continue;
    }
    if (!PASSING_CONCLUSIONS.has(run.conclusion ?? "")) return "red";
  }

  const { data: combined } = await octokit.rest.repos.getCombinedStatusForRef({
    owner,
    repo,
    ref,
  });
  const allStatuses = combined.statuses ?? [];
  const statuses = allStatuses.filter((status) => !isIgnoredCheck(status.context));
  const ignoredSomeStatus = statuses.length !== allStatuses.length;
  // When nothing was ignored, trust GitHub's rollup: it covers statuses
  // that the `statuses` array does not expand. When an ignored context is
  // in the list, judge the rest ourselves so that context cannot block.
  let sawStatus = false;
  if (ignoredSomeStatus) {
    sawStatus = statuses.length > 0;
    for (const status of statuses) {
      if (status.state === "pending") pending = true;
      else if (status.state !== "success") return "red";
    }
  } else if (combined.total_count > 0) {
    sawStatus = true;
    if (combined.state === "pending") pending = true;
    else if (combined.state !== "success") return "red";
  }

  if (!sawCheck && !sawStatus) {
    // A later check_suite/status event re-enters when CI shows up.
    // Ignored checks do not count — they never report on these PRs.
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
