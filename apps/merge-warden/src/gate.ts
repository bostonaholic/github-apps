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
import { assess, modelFromEnv } from "./assess.js";
import { armAutoMerge, disarmAutoMerge, requiresOwnCheck } from "./automerge.js";
import { checksRollup } from "./checks.js";
import type { WardenConfig } from "./config.js";
import {
  CHECK_NAME,
  LEGACY_COMMENT_MARKER,
  checkOutput,
  commentBody,
  commentMarker,
  type GradeOnly,
} from "./format.js";
import { buildGrade, type Grade } from "./grade.js";
import {
  conclusionFor,
  gradeVerdict,
  hasChangesRequested,
  isApprovedAtHead,
  allowsGradeOnly,
  mergeDecision,
  scopeBlock,
  type LiveFacts,
  type ReviewFacts,
  type ScopeFacts,
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
  // This app's login as GitHub reports it on `auto_merge.enabled_by`. The
  // app disarms only auto-merge it armed itself.
  botLogin: string;
  // Called only when a diff is about to be graded, so a missing API key
  // fails that grade and nothing else.
  anthropic: () => Anthropic;
  // The model that grades. Unset: the default (ANTHROPIC_MODEL or
  // DEFAULT_MODEL). Set by the PR comment command.
  model?: string;
  // The login of the person who asked for this grade with the PR comment
  // command. Only such a request grades an out-of-scope pull request, and
  // only in grade-only mode.
  requestedBy?: string;
  log?: Logger;
}

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

function scopeFacts(pr: PullRequest): ScopeFacts {
  return {
    authorLogin: pr.user?.login ?? null,
    headRepo: pr.head.repo?.full_name ?? null,
    baseRepo: pr.base.repo.full_name,
    baseRef: pr.base.ref,
    defaultBranch: pr.base.repo.default_branch,
  };
}

function outOfScope(pr: PullRequest, config: WardenConfig): string | null {
  return scopeBlock(scopeFacts(pr), config);
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

  // Disarm native auto-merge if this app armed it. A person's own
  // auto-merge is theirs and is left alone.
  const disarm = async (current: PullRequest) => {
    if (current.auto_merge?.enabled_by?.login !== params.botLogin) return;
    await disarmAutoMerge(octokit, current.node_id);
    log.info(`${tag}: disarmed auto-merge`);
  };

  const scope = outOfScope(pr, config);
  if (scope) {
    await disarm(pr);
    const requestedBy = params.requestedBy;
    if (mode !== "regrade" || requestedBy === undefined || !allowsGradeOnly(scopeFacts(pr))) {
      log.info(`${tag}: out of scope — ${scope}`);
      return;
    }
    // A person asked for this grade. Grade and report it, and stop there:
    // no approval, no auto-merge, no merge, whatever the grade.
    const defaultModel = modelFromEnv();
    const model = params.model ?? defaultModel;
    const verdict = await gradeHead(octokit, {
      owner,
      repo,
      pr,
      config,
      anthropic: params.anthropic,
      model,
      isDefaultModel: model === defaultModel,
      botLogin: params.botLogin,
      log,
      beforePublish: async () => {},
      gradeOnly: { requestedBy, scope },
    });
    log.info(
      `${tag}: graded ${pr.head.sha} with ${model} for ${requestedBy}, grade only (${scope}) — ${verdict.reason}`,
    );
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

  // Disarm before anything slow and before any verdict is published.
  // GitHub keeps auto-merge armed across pushes, and a neutral check
  // satisfies a required check, so an armed pull request that is being
  // graded, or is no longer eligible, must be disarmed first. If this
  // throws, reconcile stops here: no model call, no check run.
  if (mustGrade || !mergeDecision(conclusion, live.facts).eligible) {
    await disarm(pr);
  }

  const approve = () =>
    octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      // Without this GitHub approves whatever the head is at call time.
      commit_id: head,
      // No body: the grade comment already explains the approval, and a
      // review body shows on the pull request as a second comment.
      event: "APPROVE",
    });

  const rollupOfHead = () =>
    checksRollup(octokit, { owner, repo, ref: head, appId, ciChecks: config.ci_checks });

  // Approve while the claim is still in progress. Publishing the verdict
  // completes the app's check suite, and GitHub answers with
  // `check_suite.completed`: a second run that would list reviews before
  // this run's approval exists and approve too. Until the verdict is
  // published, every other run sees a commit that is still being graded
  // and does not act. Same conditions as the approval below. A failure
  // here is not final: that approval tries again.
  const approveBeforeVerdict = async (verdict: Verdict) => {
    try {
      const current = await getPull();
      if (current.state !== "open" || current.head.sha !== head) return;
      if (outOfScope(current, config)) return;
      const fresh = await readLive(octokit, { owner, repo, pr: current });
      if (fresh.approvedAtHead) return;
      if (!mergeDecision(conclusionFor(verdict), fresh.facts).eligible) return;
      if ((await rollupOfHead()) === "red") return;
      await approve();
    } catch (error) {
      log.warn(`${tag}: approval before the verdict failed — ${errorMessage(error)}`);
    }
  };

  if (mustGrade) {
    const defaultModel = modelFromEnv();
    const model = params.model ?? defaultModel;
    const verdict = await gradeHead(octokit, {
      owner,
      repo,
      pr,
      config,
      anthropic: params.anthropic,
      model,
      isDefaultModel: model === defaultModel,
      botLogin: params.botLogin,
      log,
      beforePublish: approveBeforeVerdict,
      gradeOnly: null,
    });
    log.info(`${tag}: graded ${head} with ${model} — ${verdict.reason}`);
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

  const rollup = await rollupOfHead();
  if (rollup === "red") {
    // Native auto-merge waits only for required checks. Disarm so a
    // failing optional check stops the merge on both paths.
    await disarm(pr);
    log.warn(`${tag}: checks failing; not merging`);
    return;
  }

  if (!live.approvedAtHead) await approve();

  // Already armed, by this app on an earlier event or by a person.
  if (pr.auto_merge) return;

  const ownCheckRequired = await requiresOwnCheck(octokit, {
    owner,
    repo,
    branch: pr.base.ref,
    checkName: CHECK_NAME,
    appId,
  });
  if (ownCheckRequired) {
    const outcome = await armAutoMerge(octokit, {
      pullRequestId: pr.node_id,
      mergeMethod: config.merge_method,
      head,
    });
    if (outcome.armed) {
      log.info(`${tag}: armed auto-merge for ${head}`);
      return;
    }
    log.info(`${tag}: auto-merge not armed (${outcome.why}); merging directly`);
  }

  if (rollup === "pending") {
    // A later check_suite/status event re-enters reconcile.
    log.info(
      config.ci_checks.length === 0
        ? `${tag}: no ci_checks configured; direct merge is off`
        : `${tag}: waiting for ci_checks to succeed`,
    );
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
  {
    owner,
    repo,
    pr,
    config,
    anthropic,
    model,
    isDefaultModel,
    botLogin,
    log,
    beforePublish,
    gradeOnly,
  }: {
    owner: string;
    repo: string;
    pr: PullRequest;
    config: WardenConfig;
    anthropic: () => Anthropic;
    model: string;
    isDefaultModel: boolean;
    botLogin: string;
    log: Logger;
    // Runs for an eligible verdict, while the claim is still in progress.
    beforePublish: (verdict: Verdict) => Promise<void>;
    // Set when a person asked for a grade of an out-of-scope pull request.
    gradeOnly: GradeOnly | null;
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

  let grade: Grade;
  let verdict: Verdict;
  try {
    const files = await changedFiles(octokit, {
      owner,
      repo,
      base: pr.base.sha,
      head: pr.head.sha,
    });
    const signals = readSignals(files, pr.changed_files);
    // The model sees the whole diff or none of it.
    const assessment =
      signals.ungradeable === null ? await assess(anthropic(), files, log, model) : null;
    grade = buildGrade(
      signals,
      assessment,
      pr.labels.map((label) => label.name),
    );
    verdict = gradeVerdict(grade);
    if (verdict.eligible) await beforePublish(verdict);
    await octokit.rest.checks.update({
      owner,
      repo,
      check_run_id: Number(claim.id),
      status: "completed",
      // Grade only: always neutral, so a stored success never lets a
      // later event merge a pull request nobody asked the app to merge.
      conclusion: gradeOnly ? "neutral" : conclusionFor(verdict),
      output: checkOutput(grade, verdict, model, gradeOnly),
    });
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

  // The verdict is published; the comment only reports it. A failed
  // comment is logged and changes nothing else.
  try {
    await upsertComment(octokit, {
      owner,
      repo,
      issue_number: pr.number,
      botLogin,
      // A grade with the default model also takes over a comment written
      // before comments were per model.
      markers: isDefaultModel
        ? [commentMarker(model), LEGACY_COMMENT_MARKER]
        : [commentMarker(model)],
      body: commentBody(grade, verdict, pr.head.sha, model, gradeOnly),
    });
  } catch (error) {
    log.warn(`${owner}/${repo}#${pr.number}: grade comment failed — ${errorMessage(error)}`);
  }
  return verdict;
}

// One grade comment per model per pull request: edit the app's own, else
// create it. Only a comment this app wrote counts, so anyone can quote the
// marker. The marker is matched as the whole first line, so one model's
// marker never matches another's.
async function upsertComment(
  octokit: Octokit,
  { owner, repo, issue_number, botLogin, markers, body }: {
    owner: string;
    repo: string;
    issue_number: number;
    botLogin: string;
    markers: string[];
    body: string;
  },
): Promise<void> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number,
    per_page: 100,
  });
  const own = comments.find(
    (comment) =>
      comment.user?.login === botLogin &&
      markers.includes((comment.body ?? "").split("\n", 1)[0].trim()),
  );
  if (own) {
    if (own.body === body) return;
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: own.id, body });
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number, body });
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
