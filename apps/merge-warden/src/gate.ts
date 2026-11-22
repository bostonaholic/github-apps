// Orchestration: grade a pull request once per head commit and merge it
// when the grade and the live state of the PR allow. Idempotent: every
// webhook re-enters here, fetches current state, and converges.
//
// The app's own check run on the head commit is the only stored state.
// Its conclusion is the verdict for that commit: `success` means eligible
// for auto-merge, `neutral` means a person must merge. Only this app can
// write its check runs, so a pull request cannot edit its own verdict.

import type Anthropic from "@anthropic-ai/sdk";
import type { Context } from "probot";
import { assess } from "./assess.js";
import type { WardenConfig } from "./config.js";
import { CHECK_NAME, checkOutput } from "./format.js";
import { buildGrade } from "./grade.js";
import { gradeVerdict, scopeBlock, type Verdict } from "./policy.js";
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

export async function reconcile(
  octokit: Octokit,
  params: ReconcileParams,
): Promise<void> {
  const { owner, repo, pull_number, config, mode } = params;
  const log = params.log ?? NOOP_LOG;
  const tag = `${owner}/${repo}#${pull_number}`;

  if (!config.enabled) return;

  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number });
  if (pr.state !== "open") return;

  const outOfScope = scopeBlock(
    {
      authorLogin: pr.user?.login ?? null,
      headRepo: pr.head.repo?.full_name ?? null,
      baseRepo: pr.base.repo.full_name,
      baseRef: pr.base.ref,
      defaultBranch: pr.base.repo.default_branch,
    },
    config,
  );
  if (outOfScope) {
    log.info(`${tag}: out of scope — ${outOfScope}`);
    return;
  }

  const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
    owner,
    repo,
    ref: pr.head.sha,
    check_name: CHECK_NAME,
    app_id: params.appId,
    filter: "all",
    per_page: 100,
  });
  const stored = storedVerdict(runs, Date.now());

  if (mode === "act") return;
  // A fresh claim or an existing verdict stops a plain grade. A regrade
  // goes ahead either way; its run is newer, so its verdict wins.
  if (mode === "grade" && stored.state !== "none") return;

  const verdict = await gradeHead(octokit, {
    owner,
    repo,
    pr,
    config,
    anthropic: params.anthropic,
    log,
  });
  log.info(`${tag}: graded ${pr.head.sha} — ${verdict.reason}`);
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
      conclusion: verdict.eligible ? "success" : "neutral",
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
