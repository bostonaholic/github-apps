import { describe, expect, it } from "vitest";
import { DEFAULTS, normalizeConfig } from "../src/policy.js";
import { reconcile } from "../src/shepherd.js";

interface FakeOptions {
  pr?: Record<string, unknown>;
  reviews?: Record<string, unknown>[];
  checkRuns?: { name?: string; status: string; conclusion: string | null }[];
  combinedStatus?: {
    state: string;
    total_count: number;
    statuses?: { context: string; state: string }[];
  };
  mergeError?: number;
  // Repo has workflow files (default: none — .github/workflows 404s).
  workflows?: boolean;
}

function fakeOctokit(options: FakeOptions = {}) {
  const calls = {
    gets: 0,
    approvals: [] as Record<string, unknown>[],
    merges: [] as Record<string, unknown>[],
    paginated: [] as string[],
  };

  const pr = {
    state: "open",
    draft: false,
    title: "Bump lodash from 4.17.20 to 4.17.21",
    body: "",
    labels: [] as { name: string }[],
    user: { login: "dependabot[bot]", type: "Bot" },
    head: { sha: "abc123", ref: "dependabot/npm_and_yarn/lodash-4.17.21" },
    node_id: "PR_1",
    ...options.pr,
  };

  const octokit = {
    rest: {
      pulls: {
        get: async () => {
          calls.gets += 1;
          return { data: pr };
        },
        listReviews: "listReviews",
        createReview: async (params: Record<string, unknown>) => {
          calls.approvals.push(params);
          return {};
        },
        merge: async (params: Record<string, unknown>) => {
          calls.merges.push(params);
          if (options.mergeError) {
            const error = new Error("merge refused") as Error & { status: number };
            error.status = options.mergeError;
            throw error;
          }
          return {};
        },
      },
      checks: { listForRef: "listForRef" },
      repos: {
        getCombinedStatusForRef: async () => ({
          data: options.combinedStatus ?? { state: "success", total_count: 0 },
        }),
        getContent: async () => {
          if (options.workflows) return { data: [{ name: "ci.yml" }] };
          const error = new Error("Not Found") as Error & { status: number };
          error.status = 404;
          throw error;
        },
      },
    },
    paginate: async (route: unknown) => {
      calls.paginated.push(route as string);
      if (route === "listReviews") return options.reviews ?? [];
      if (route === "listForRef") return options.checkRuns ?? [];
      throw new Error(`unexpected paginate route: ${String(route)}`);
    },
  };

  return { octokit, calls };
}

const params = { owner: "o", repo: "r", pull_number: 1, config: DEFAULTS };

async function run(
  options: FakeOptions = {},
  overrides: Partial<typeof params & { allowAuthor: string }> = {},
) {
  const { octokit, calls } = fakeOctokit(options);
  // The fake is structurally compatible with the narrow slice of octokit
  // that reconcile uses.
  await reconcile(octokit as never, { ...params, ...overrides });
  return calls;
}

describe("reconcile", () => {
  it("approves and squash-merges an allowed update, pinned to the head sha", async () => {
    const calls = await run();
    expect(calls.approvals).toHaveLength(1);
    expect(calls.approvals[0].event).toBe("APPROVE");
    expect(calls.approvals[0].body).toContain("lodash 4.17.20 → 4.17.21");
    expect(calls.merges).toEqual([
      expect.objectContaining({ merge_method: "squash", sha: "abc123" }),
    ]);
  });

  it("does not stack approvals on the same head commit", async () => {
    const calls = await run({
      reviews: [
        { user: { login: "shepherd[bot]" }, state: "APPROVED", commit_id: "abc123" },
      ],
    });
    expect(calls.approvals).toHaveLength(0);
    expect(calls.merges).toHaveLength(1);
  });

  it("re-approves after the head moved", async () => {
    const calls = await run({
      reviews: [
        { user: { login: "shepherd[bot]" }, state: "APPROVED", commit_id: "old" },
      ],
    });
    expect(calls.approvals).toHaveLength(1);
  });

  it("uses the configured merge method", async () => {
    const calls = await run({}, { config: normalizeConfig({ merge_method: "rebase" }) });
    expect(calls.merges[0].merge_method).toBe("rebase");
    expect(calls.merges[0].sha).toBe("abc123");
  });

  it("merges when checks are green", async () => {
    const calls = await run({
      checkRuns: [{ name: "ci", status: "completed", conclusion: "success" }],
    });
    expect(calls.merges).toEqual([
      expect.objectContaining({ merge_method: "squash", sha: "abc123" }),
    ]);
  });

  it("treats skipped checks as green", async () => {
    const calls = await run({
      checkRuns: [
        { name: "ci", status: "completed", conclusion: "skipped" },
        { name: "lint", status: "completed", conclusion: "success" },
      ],
    });
    expect(calls.merges).toHaveLength(1);
  });

  it("ignores the Cursor Security Agent check that never reports", async () => {
    const calls = await run({
      checkRuns: [
        { name: "ci", status: "completed", conclusion: "success" },
        {
          name: "Cursor Security Agent: Security Reviewer",
          status: "queued",
          conclusion: null,
        },
      ],
    });
    expect(calls.merges).toHaveLength(1);
  });

  it("ignores a failed Cursor Security Agent check", async () => {
    const calls = await run({
      checkRuns: [
        { name: "ci", status: "completed", conclusion: "success" },
        {
          name: "Cursor Security Agent: Security Reviewer",
          status: "completed",
          conclusion: "failure",
        },
      ],
    });
    expect(calls.merges).toHaveLength(1);
  });

  it("ignores that check when it is posted as a commit status", async () => {
    const calls = await run({
      checkRuns: [{ name: "ci", status: "completed", conclusion: "success" }],
      combinedStatus: {
        state: "pending",
        total_count: 2,
        statuses: [
          { context: "ci/circleci", state: "success" },
          { context: "Cursor Security Agent: Security Reviewer", state: "pending" },
        ],
      },
    });
    expect(calls.merges).toHaveLength(1);
  });

  it("still waits for real CI when the only check is the ignored one", async () => {
    const calls = await run({
      workflows: true,
      checkRuns: [
        {
          name: "Cursor Security Agent: Security Reviewer",
          status: "queued",
          conclusion: null,
        },
      ],
    });
    expect(calls.merges).toHaveLength(0);
  });

  it("merges a repo with no CI at all (zero checks, no workflows)", async () => {
    const calls = await run();
    expect(calls.merges).toHaveLength(1);
  });

  it("waits when checks have not appeared yet but the repo has workflows", async () => {
    const calls = await run({ workflows: true });
    expect(calls.merges).toHaveLength(0);
    expect(calls.approvals).toHaveLength(1);
  });

  it("waits while checks are still running", async () => {
    const calls = await run({
      checkRuns: [{ name: "ci", status: "in_progress", conclusion: null }],
    });
    expect(calls.merges).toHaveLength(0);
  });

  it("never merges over red check runs", async () => {
    const calls = await run({
      checkRuns: [{ name: "ci", status: "completed", conclusion: "failure" }],
    });
    expect(calls.merges).toHaveLength(0);
  });

  it("never merges over a red combined status", async () => {
    const calls = await run({
      combinedStatus: { state: "failure", total_count: 2 },
    });
    expect(calls.merges).toHaveLength(0);
  });

  it("does not let an ignored status hide a red one", async () => {
    const calls = await run({
      combinedStatus: {
        state: "failure",
        total_count: 2,
        statuses: [
          { context: "ci/circleci", state: "failure" },
          { context: "Cursor Security Agent: Security Reviewer", state: "pending" },
        ],
      },
    });
    expect(calls.merges).toHaveLength(0);
  });

  it("swallows a merge race (405/409)", async () => {
    const calls = await run({ mergeError: 409 });
    expect(calls.merges).toHaveLength(1);
  });

  it("merges majors", async () => {
    const calls = await run({ pr: { title: "Bump react from 18.0.0 to 19.0.0" } });
    expect(calls.approvals).toHaveLength(1);
    expect(calls.merges).toHaveLength(1);
  });

  it("leaves unknown bumps alone", async () => {
    const calls = await run({
      pr: { title: "Bump actions/checkout from abcdef to 123456" },
    });
    expect(calls.approvals).toHaveLength(0);
    expect(calls.merges).toHaveLength(0);
  });

  it("respects the ignore label", async () => {
    const calls = await run({ pr: { labels: [{ name: "shepherd: ignore" }] } });
    expect(calls.approvals).toHaveLength(0);
  });

  it("skips drafts", async () => {
    const calls = await run({ pr: { draft: true } });
    expect(calls.approvals).toHaveLength(0);
  });

  it("skips while a reviewer's latest verdict is changes requested", async () => {
    const calls = await run({
      reviews: [{ user: { login: "alice" }, state: "CHANGES_REQUESTED", commit_id: "x" }],
    });
    expect(calls.approvals).toHaveLength(0);
    expect(calls.merges).toHaveLength(0);
  });

  it("ignores PRs not authored by dependabot", async () => {
    const calls = await run({ pr: { user: { login: "alice", type: "User" } } });
    expect(calls.paginated).toHaveLength(0);
    expect(calls.approvals).toHaveLength(0);
  });

  it("ignores dependabot-authored PRs on a non-dependabot branch", async () => {
    const calls = await run({
      pr: { head: { sha: "abc123", ref: "feature/thing" } },
    });
    expect(calls.approvals).toHaveLength(0);
  });

  it("accepts the e2e allowAuthor seam", async () => {
    const calls = await run(
      { pr: { user: { login: "matthew", type: "User" } } },
      { allowAuthor: "matthew" },
    );
    expect(calls.approvals).toHaveLength(1);
  });

  it("does nothing at all when disabled", async () => {
    const calls = await run({}, { config: normalizeConfig({ enabled: false }) });
    expect(calls.gets).toBe(0);
  });

  it("does nothing for a closed PR", async () => {
    const calls = await run({ pr: { state: "closed" } });
    expect(calls.paginated).toHaveLength(0);
  });
});
