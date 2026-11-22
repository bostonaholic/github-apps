// Orchestration: grade a pull request once per head commit and merge it
// when the grade and the live state of the PR allow. Idempotent: every
// webhook re-enters here, fetches current state, and converges.
//
// The app's own check run on the head commit is the only stored state.
// Its conclusion is the verdict for that commit: `success` means eligible
// for auto-merge, `neutral` means a person must merge. Only this app can
// write its check runs, so a pull request cannot edit its own verdict.
//
// Everything else — labels, draft state, reviews, the head commit itself —
// is read fresh on every event and never trusted from an earlier one.

import type Anthropic from "@anthropic-ai/sdk";
import type { Context } from "probot";
import { assess } from "./assess.js";
import { checksRollup } from "./checks.js";
import type { WardenConfig } from "./config.js";
import { CHECK_NAME, checkOutput } from "./format.js";
import { buildGrade } from "./grade.js";
import {
  conclusionFor,
  gradeVerdict,
  hasChangesRequested,
  isApprovedAtHead,
  mergeDecision,
  scopeBlock,
  type LiveFacts,
  type ReviewFacts,
  type Verdict,
} from "./policy.js";
import { readSignals, type ChangedFile } from "./signals.js";

type Octokit = Context["octokit"];
type PullRequest = Awaited<ReturnType<Octokit["rest"]["pulls"]["get"]>>["data"];

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const NOOP_LOG: Logger = { info() {}, warn() {}, error() {} };

// What the triggering event allows:
// - grade:   grade the head commit if it has no verdict yet, then act
// - regrade: grade again even if a verdict exists, then act
// - act:     never grade; act on the stored verdict only
export type Mode = "grade" | "regrade" | "act";

export interface ReconcileParams {
  owner: string;
  repo: string;
  pull_number: number;
  config: WardenConfig;
  mode: Mode;
  // This app's id. Own check runs are found by it, never by name alone:
  // any app with checks:write can create a run called "merge-warden".
  appId: number;
  // Called only when a diff is about to be graded, so a missing API key
  // fails that grade and nothing else.
  anthropic: () => Anthropic;
  log?: Logger;
}

// Fixed text. Nothing the model wrote goes into a review.
const APPROVAL_BODY =
  "Approved by merge-warden: low risk, two-way door. The grade is in the `merge-warden` check on this commit.";

// An in-progress own check run is a claim: another invocation is grading
// this commit. A claim older than this was abandoned (the function was
// killed) and no longer counts.
const CLAIM_TTL_MS = 10 * 60 * 1000;

type StoredVerdict =
  | { state: "none" }
  | { state: "grading" }
  | { state: "done"; conclusion: string | null };

interface OwnRun {
  // The REST types allow bigint ids; comparison works across both.
  id: number | bigint;
  status: string;
  conclusion: string | null;
  started_at: string | null;
}

// The newest own run decides. Completed: that is the verdict. In progress
// and fresh: a grade is under way. Otherwise there is no verdict.
function storedVerdict(runs: OwnRun[], now: number): StoredVerdict {
  let newest: OwnRun | null = null;
  for (const run of runs) {
    if (newest === null || run.id > newest.id) newest = run;
  }
  if (newest === null) return { state: "none" };
  if (newest.status === "completed") {
    return { state: "done", conclusion: newest.conclusion };
  }
  const startedAt = newest.started_at ? Date.parse(newest.started_at) : 0;
  return now - startedAt < CLAIM_TTL_MS ? { state: "grading" } : { state: "none" };
}

function outOfScope(pr: PullRequest, config: WardenConfig): string | null {
  return scopeBlock(
    {
      authorLogin: pr.user?.login ?? null,
      headRepo: pr.head.repo?.full_name ?? null,
      baseRepo: pr.base.repo.full_name,
      baseRef: pr.base.ref,
      defaultBranch: pr.base.repo.default_branch,
    },
    config,
  );
}

export async function reconcile(
  octokit: Octokit,
  params: ReconcileParams,
): Promise<void> {
  const { owner, repo, pull_number, config, mode, appId } = params;
  const log = params.log ?? NOOP_LOG;
  const tag = `${owner}/${repo}#${pull_number}`;

  if (!config.enabled) return;

  const getPull = async () =>
    (await octokit.rest.pulls.get({ owner, repo, pull_number })).data;

  let pr = await getPull();
  if (pr.state !== "open") return;

  const scope = outOfScope(pr, config);
  if (scope) {
    log.info(`${tag}: out of scope — ${scope}`);
    return;
  }

  // The commit every later step is pinned to. If the head moves, the
  // approval, the merge, and the verdict all refuse the new commit.
  const head = pr.head.sha;

  let live = await readLive(octokit, { owner, repo, pr });
  const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
    owner,
    repo,
    ref: head,
    check_name: CHECK_NAME,
    app_id: appId,
    filter: "all",
    per_page: 100,
  });
  const stored = storedVerdict(runs, Date.now());
  let conclusion = stored.state === "done" ? stored.conclusion : null;

  // A fresh claim or an existing verdict stops a plain grade. A regrade
  // goes ahead either way; its run is newer, so its verdict wins.
  const mustGrade = mode === "regrade" || (mode === "grade" && stored.state === "none");

  if (mustGrade) {
    const verdict = await gradeHead(octokit, {
      owner,
      repo,
      pr,
      config,
      anthropic: params.anthropic,
      log,
    });
    log.info(`${tag}: graded ${head} — ${verdict.reason}`);
    conclusion = conclusionFor(verdict);
    if (!verdict.eligible) return;

    // The model call takes seconds. Act only on what is true now.
    pr = await getPull();
    if (pr.state !== "open" || pr.head.sha !== head || outOfScope(pr, config)) {
      log.info(`${tag}: pull request changed during grading; not acting`);
      return;
    }
    live = await readLive(octokit, { owner, repo, pr });
  }

  const decision = mergeDecision(conclusion, live.facts);
  if (!decision.eligible) {
    log.info(`${tag}: not merging — ${decision.reason}`);
    return;
  }

  const rollup = await checksRollup(octokit, { owner, repo, ref: head, appId });
  if (rollup === "red") {
    log.warn(`${tag}: checks failing; not merging`);
    return;
  }

  if (!live.approvedAtHead) {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      // Without this GitHub approves whatever the head is at call time.
      commit_id: head,
      event: "APPROVE",
      body: APPROVAL_BODY,
    });
  }

  if (rollup === "pending") {
    // A later check_suite/status event re-enters reconcile.
    log.info(`${tag}: checks still running`);
    return;
  }

  try {
    await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number,
      merge_method: config.merge_method,
      // Refuse the merge if the head moved since it was graded.
      sha: head,
    });
    log.info(`${tag}: merged ${head}`);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 405 || status === 409) {
      // Already merged, blocked by branch protection, or the head moved —
      // a later event will reconcile again.
      log.info(`${tag}: merge skipped (${status})`);
      return;
    }
    log.error(`${tag}: merge failed — ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readLive(
  octokit: Octokit,
  { owner, repo, pr }: { owner: string; repo: string; pr: PullRequest },
): Promise<{ facts: LiveFacts; approvedAtHead: boolean }> {
  const reviews: ReviewFacts[] = (
    await octokit.paginate(octokit.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number: pr.number,
      per_page: 100,
    })
  ).map((review) => ({
    userLogin: review.user?.login ?? null,
    state: review.state,
    commitId: review.commit_id ?? null,
  }));
  return {
    facts: {
      labels: pr.labels.map((label) => label.name),
      draft: pr.draft === true,
      changesRequested: hasChangesRequested(reviews),
    },
    approvedAtHead: isApprovedAtHead(reviews, pr.head.sha),
  };
}

async function gradeHead(
  octokit: Octokit,
  { owner, repo, pr, config, anthropic, log }: {
    owner: string;
    repo: string;
    pr: PullRequest;
    config: WardenConfig;
    anthropic: () => Anthropic;
    log: Logger;
  },
): Promise<Verdict> {
  const { data: claim } = await octokit.rest.checks.create({
    owner,
    repo,
    name: CHECK_NAME,
    head_sha: pr.head.sha,
    status: "in_progress",
    output: { title: "Grading", summary: "Grading this commit." },
  });

  try {
    const files = await changedFiles(octokit, {
      owner,
      repo,
      base: pr.base.sha,
      head: pr.head.sha,
    });
    const signals = readSignals(files, config, pr.changed_files);
    // The model sees the whole diff or none of it.
    const assessment =
      signals.ungradeable === null ? await assess(anthropic(), files, log) : null;
    const grade = buildGrade(
      signals,
      assessment,
      pr.labels.map((label) => label.name),
    );
    const verdict = gradeVerdict(grade);
    await octokit.rest.checks.update({
      owner,
      repo,
      check_run_id: Number(claim.id),
      status: "completed",
      conclusion: conclusionFor(verdict),
      output: checkOutput(grade, verdict),
    });
    return verdict;
  } catch (error) {
    // Release the claim so the commit does not sit "in progress". Neutral,
    // never failure: a required check must not block a manual merge.
    await octokit.rest.checks.update({
      owner,
      repo,
      check_run_id: Number(claim.id),
      status: "completed",
      conclusion: "neutral",
      output: {
        title: "Needs a person: could not grade",
        summary: "Grading failed. Re-run this check to grade the commit again.",
      },
    });
    throw error;
  }
}

// The diff pinned to two commits, so it cannot change under the grade.
// Three dots: from the merge base to the head, which is the PR's diff.
async function changedFiles(
  octokit: Octokit,
  { owner, repo, base, head }: { owner: string; repo: string; base: string; head: string },
): Promise<ChangedFile[]> {
  const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${base}...${head}`,
  });
  return (data.files ?? []).map((file) => ({
    filename: file.filename,
    previous_filename: file.previous_filename,
    status: file.status,
    changes: file.changes,
    patch: file.patch,
  }));
}
