// A hand-written structural fake of the GitHub REST calls the app makes,
// backed by mutable state, so a test can drive several webhook
// deliveries against one repo. It has no method that writes code, merges,
// or touches a pull request: a call to one would throw.

export const BOT = "fix-forward-bostonaholic[bot]";
export const ACTIONS = { id: 15368, slug: "github-actions" };
export const OTHER_APP = { id: 999, slug: "other-ci" };

export interface FakeRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  app: { id: number; slug: string };
  check_suite: { id: number };
  html_url?: string;
}

export interface FakeWorkflowRun {
  id: number;
  check_suite_id: number;
  run_attempt: number;
}

export interface FakeIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: { name: string }[];
  user: { login: string };
  pull_request?: object;
}

export interface FakeState {
  // Default-branch commits, newest first.
  commits: string[];
  runs: Record<string, FakeRun[]>;
  statuses: Record<string, { context: string; state: string; target_url?: string }[]>;
  workflowRuns: Record<string, FakeWorkflowRun[]>;
  jobs: Record<number, { name: string; steps: { name: string; conclusion: string | null; started_at: string; completed_at: string }[] }>;
  logs: Record<number, string>;
  prs: Record<string, { number: number; title: string; html_url: string; merged_at: string | null; merge_commit_sha: string; base: { ref: string } }[]>;
  issues: FakeIssue[];
  comments: Record<number, { user: { login: string }; body: string }[]>;
  labels: Set<string>;
  reruns: number[];
  calls: string[];
}

let nextId = 1000;

// An Actions check run in its own workflow run's check suite.
export function actionsRun(
  state: FakeState,
  sha: string,
  name: string,
  conclusion: string | null,
  attempt = 1,
): FakeRun {
  const suite = nextId++;
  const run: FakeRun = {
    id: nextId++,
    name,
    status: conclusion === null ? "in_progress" : "completed",
    conclusion,
    app: ACTIONS,
    check_suite: { id: suite },
    html_url: `https://github.com/o/r/actions/runs/${suite}/job/${name}`,
  };
  (state.runs[sha] ??= []).push(run);
  (state.workflowRuns[sha] ??= []).push({ id: suite + 50_000, check_suite_id: suite, run_attempt: attempt });
  state.jobs[run.id] = {
    name,
    steps: [
      { name: "Set up job", conclusion: "success", started_at: "2026-11-22T10:00:00Z", completed_at: "2026-11-22T10:00:01Z" },
      { name: "Run tests", conclusion: conclusion === "success" ? "success" : "failure", started_at: "2026-11-22T10:00:02Z", completed_at: "2026-11-22T10:00:03Z" },
    ],
  };
  state.logs[run.id] = [
    "2026-11-22T10:00:00.1000000Z setting up",
    "2026-11-22T10:00:02.1000000Z running tests",
    "2026-11-22T10:00:03.5000000Z FAIL expected 1 to be 2",
  ].join("\n");
  return run;
}

export function fakeGitHub(init: Partial<FakeState> = {}) {
  const state: FakeState = {
    commits: [],
    runs: {},
    statuses: {},
    workflowRuns: {},
    jobs: {},
    logs: {},
    prs: {},
    issues: [],
    comments: {},
    labels: new Set(),
    reruns: [],
    calls: [],
    ...init,
  };
  const call = (name: string) => state.calls.push(name);

  const octokit = {
    paginate: async (route: (params: never) => Promise<{ data: unknown }>, params: never) => {
      const { data } = await route(params);
      if (Array.isArray(data)) return data;
      return (data as { check_runs: unknown[] }).check_runs;
    },
    rest: {
      checks: {
        listForRef: async ({ ref }: { ref: string }) => {
          call("checks.listForRef");
          const runs = state.runs[ref] ?? [];
          return { data: { total_count: runs.length, check_runs: runs } };
        },
      },
      repos: {
        listCommits: async ({ per_page }: { per_page: number }) => {
          call("repos.listCommits");
          return { data: state.commits.slice(0, per_page).map((sha) => ({ sha })) };
        },
        getCombinedStatusForRef: async ({ ref, page = 1, per_page = 30 }: { ref: string; page?: number; per_page?: number }) => {
          call("repos.getCombinedStatusForRef");
          const all = state.statuses[ref] ?? [];
          const start = (page - 1) * per_page;
          return { data: { total_count: all.length, statuses: all.slice(start, start + per_page) } };
        },
        listPullRequestsAssociatedWithCommit: async ({ commit_sha }: { commit_sha: string }) => {
          call("repos.listPullRequestsAssociatedWithCommit");
          return { data: state.prs[commit_sha] ?? [] };
        },
      },
      actions: {
        listWorkflowRunsForRepo: async ({ head_sha }: { head_sha: string }) => {
          call("actions.listWorkflowRunsForRepo");
          return { data: { workflow_runs: state.workflowRuns[head_sha] ?? [] } };
        },
        // As on GitHub: the failed jobs get new, queued check runs and
        // the workflow run moves to its next attempt.
        reRunWorkflowFailedJobs: async ({ run_id }: { run_id: number }) => {
          call("actions.reRunWorkflowFailedJobs");
          state.reruns.push(run_id);
          for (const [sha, runs] of Object.entries(state.workflowRuns)) {
            const wf = runs.find((r) => r.id === run_id);
            if (!wf) continue;
            wf.run_attempt += 1;
            for (const run of [...(state.runs[sha] ?? [])]) {
              if (run.check_suite.id !== wf.check_suite_id || run.conclusion !== "failure") continue;
              const retry = { ...run, id: nextId++, status: "queued", conclusion: null };
              state.runs[sha]!.push(retry);
              state.jobs[retry.id] = state.jobs[run.id]!;
              state.logs[retry.id] = state.logs[run.id]!;
            }
          }
          return { data: {} };
        },
        getJobForWorkflowRun: async ({ job_id }: { job_id: number }) => {
          call("actions.getJobForWorkflowRun");
          const job = state.jobs[job_id];
          if (!job) throw Object.assign(new Error("Not Found"), { status: 404 });
          return { data: job };
        },
        downloadJobLogsForWorkflowRun: async ({ job_id }: { job_id: number }) => {
          call("actions.downloadJobLogsForWorkflowRun");
          const log = state.logs[job_id];
          if (log === undefined) throw Object.assign(new Error("Gone"), { status: 410 });
          return { data: log };
        },
      },
      issues: {
        listForRepo: async ({ labels }: { labels: string }) => {
          call("issues.listForRepo");
          const matching = state.issues.filter((i) => i.labels.some((l) => l.name === labels));
          return { data: [...matching].sort((a, b) => b.number - a.number) };
        },
        getLabel: async ({ name }: { name: string }) => {
          call("issues.getLabel");
          if (!state.labels.has(name)) throw Object.assign(new Error("Not Found"), { status: 404 });
          return { data: { name } };
        },
        createLabel: async ({ name }: { name: string }) => {
          call("issues.createLabel");
          state.labels.add(name);
          return { data: { name } };
        },
        // As on GitHub: a label that does not exist is dropped.
        create: async ({ title, body, labels }: { title: string; body: string; labels: string[] }) => {
          call("issues.create");
          const issue: FakeIssue = {
            number: state.issues.length + 1,
            title,
            body,
            state: "open",
            labels: labels.filter((l) => state.labels.has(l)).map((name) => ({ name })),
            user: { login: BOT },
          };
          state.issues.push(issue);
          return { data: issue };
        },
        update: async ({ issue_number, body, state: next }: { issue_number: number; body?: string; state?: "open" | "closed" }) => {
          call("issues.update");
          const issue = state.issues.find((i) => i.number === issue_number)!;
          if (body !== undefined) issue.body = body;
          if (next !== undefined) issue.state = next;
          return { data: issue };
        },
        createComment: async ({ issue_number, body }: { issue_number: number; body: string }) => {
          call("issues.createComment");
          (state.comments[issue_number] ??= []).push({ user: { login: BOT }, body });
          return { data: {} };
        },
        listComments: async ({ issue_number }: { issue_number: number }) => {
          call("issues.listComments");
          return { data: state.comments[issue_number] ?? [] };
        },
      },
    },
  };
  return { octokit: octokit as never, state };
}

export const silentLog = { info: () => {}, warn: () => {} };
