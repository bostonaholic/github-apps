// Orchestration: grade a pull request once per head commit and merge it
// when the grade and the live state of the PR allow. Idempotent: every
// webhook re-enters here, fetches current state, and converges.

import type { Context } from "probot";
import type { WardenConfig } from "./config.js";

type Octokit = Context["octokit"];

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

  log.info(`${tag}: ${params.mode} at ${pr.head.sha}`);
}
