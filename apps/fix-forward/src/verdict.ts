// Pure: one commit's CI verdict over the checks the repo names in
// `ci_checks`, and which failed GitHub Actions runs still get their one
// flake re-run.

export interface CheckRun {
  id: number | bigint;
  name: string;
  status: string;
  conclusion: string | null;
  app?: { id: number; slug?: string } | null;
  check_suite?: { id: number } | null;
  html_url?: string | null;
  details_url?: string | null;
}

export interface CommitStatus {
  context: string;
  state: string;
  target_url?: string | null;
}

export interface WorkflowRun {
  id: number;
  check_suite_id?: number;
  run_attempt?: number;
}

// One failing named check. `jobId` and `checkSuiteId` are set only for a
// GitHub Actions check run, whose id is its job id.
export interface Failure {
  name: string;
  url: string | null;
  jobId: number | null;
  checkSuiteId: number | null;
}

export type Verdict =
  | { kind: "green" }
  | { kind: "pending" }
  | { kind: "red"; failures: Failure[] };

const ACTIONS_SLUG = "github-actions";

// Neutral and skipped are not failures, but they are not passes either:
// a skipped CI job ran no tests, so the commit stays unsettled.
const NOT_FAILED = new Set(["success", "neutral", "skipped"]);

// One commit can carry several runs of the same check: a re-run adds new
// check runs beside the old ones. Only the newest run of each check says
// where it stands now. Newest is the highest id, since GitHub assigns ids
// in creation order. Keyed by app and name, so another app's run with the
// same name never hides a failure. Copied from merge-warden's checks.ts.
export function latestRuns<Run extends CheckRun>(runs: readonly Run[]): Run[] {
  const newest = new Map<string, Run>();
  for (const run of runs) {
    const key = `${run.app?.id ?? ""}/${run.name}`;
    const seen = newest.get(key);
    if (!seen || run.id > seen.id) newest.set(key, run);
  }
  return [...newest.values()];
}

// Red when any named check failed, green when every named check
// succeeded, pending otherwise (running, skipped, or not reported yet).
// Checks the repo did not name never count.
export function commitVerdict(
  runs: readonly CheckRun[],
  statuses: readonly CommitStatus[],
  ciChecks: readonly string[],
): Verdict {
  const latest = latestRuns(runs);
  const failures: Failure[] = [];
  let settled = true;
  for (const name of ciChecks) {
    let passed = false;
    for (const run of latest.filter((r) => r.name === name)) {
      if (run.status !== "completed") settled = false;
      else if (!NOT_FAILED.has(run.conclusion ?? "")) failures.push(runFailure(run));
      else if (run.conclusion === "success") passed = true;
    }
    for (const status of statuses.filter((s) => s.context === name)) {
      if (status.state === "pending") settled = false;
      else if (status.state !== "success") {
        failures.push({ name, url: status.target_url ?? null, jobId: null, checkSuiteId: null });
      } else passed = true;
    }
    if (!passed) settled = false;
  }
  if (failures.length > 0) return { kind: "red", failures };
  return settled && ciChecks.length > 0 ? { kind: "green" } : { kind: "pending" };
}

function runFailure(run: CheckRun): Failure {
  const actions = run.app?.slug === ACTIONS_SLUG && run.check_suite != null;
  return {
    name: run.name,
    url: run.html_url ?? run.details_url ?? null,
    jobId: actions ? Number(run.id) : null,
    checkSuiteId: actions ? run.check_suite!.id : null,
  };
}

// The workflow runs to re-run once: those holding a failed job and still
// on their first attempt. A run on attempt 2 or later was already re-run
// (by this app or a person), so its failure is real. A failure with no
// matching workflow run cannot be re-run and is real too.
export function flakeReruns(
  failures: readonly Failure[],
  workflowRuns: readonly WorkflowRun[],
): number[] {
  const ids = new Set<number>();
  for (const failure of failures) {
    if (failure.checkSuiteId === null) continue;
    const run = workflowRuns.find((r) => r.check_suite_id === failure.checkSuiteId);
    if (run && (run.run_attempt ?? 1) === 1) ids.add(run.id);
  }
  return [...ids];
}
