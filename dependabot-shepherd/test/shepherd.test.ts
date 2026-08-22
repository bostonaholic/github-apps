import { describe, expect, it } from "vitest";
import { DEFAULTS, normalizeConfig } from "../src/policy.js";
import { reconcile } from "../src/shepherd.js";

interface FakeOptions {
  pr?: Record<string, unknown>;
  reviews?: Record<string, unknown>[];
  checkRuns?: { status: string; conclusion: string | null }[];
  combinedStatus?: { state: string; total_count: number };
  autoMergeError?: string;
  mergeError?: number;
  // Repo has workflow files (default: none — .github/workflows 404s).
  workflows?: boolean;
}

function fakeOctokit(options: FakeOptions = {}) {
  const calls = {
    gets: 0,
    approvals: [] as Record<string, unknown>[],
    graphql: [] as Record<string, unknown>[],
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
    graphql: async (_query: string, vars: Record<string, unknown>) => {
      calls.graphql.push(vars);
      if (options.autoMergeError) throw new Error(options.autoMergeError);
      return {};
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
  it("approves and enables auto-merge for an allowed update", async () => {
    const calls = await run();
    expect(calls.approvals).toHaveLength(1);
    expect(calls.approvals[0].event).toBe("APPROVE");
    expect(calls.approvals[0].body).toContain("lodash 4.17.20 → 4.17.21");
    expect(calls.graphql).toEqual([{ id: "PR_1", method: "SQUASH" }]);
    expect(calls.merges).toHaveLength(0);
  });

  it("does not stack approvals on the same head commit", async () => {
    const calls = await run({
      reviews: [
        { user: { login: "shepherd[bot]" }, state: "APPROVED", commit_id: "abc123" },
      ],
    });
    expect(calls.approvals).toHaveLength(0);
    expect(calls.graphql).toHaveLength(1);
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
    expect(calls.graphql[0].method).toBe("REBASE");
  });

  it("merges directly when auto-merge is not allowed and checks are green", async () => {
    const calls = await run({
      autoMergeError: "Auto merge is not allowed for this repository",
      checkRuns: [{ status: "completed", conclusion: "success" }],
    });
    expect(calls.merges).toEqual([
      expect.objectContaining({ merge_method: "squash", sha: "abc123" }),
    ]);
  });

  it("merges a repo with no CI at all (clean status, zero checks, no workflows)", async () => {
    const calls = await run({ autoMergeError: "Pull request is in clean status" });
    expect(calls.merges).toHaveLength(1);
  });

  it("waits when checks have not appeared yet but the repo has workflows", async () => {
    const calls = await run({
      autoMergeError: "Pull request is in clean status",
      workflows: true,
    });
    expect(calls.merges).toHaveLength(0);
  });

  it("waits while checks are still running", async () => {
    const calls = await run({
      autoMergeError: "Pull request is in clean status",
      checkRuns: [{ status: "in_progress", conclusion: null }],
    });
    expect(calls.merges).toHaveLength(0);
  });

  it("never merges over red check runs", async () => {
    const calls = await run({
      autoMergeError: "Pull request is in clean status",
      checkRuns: [{ status: "completed", conclusion: "failure" }],
    });
    expect(calls.merges).toHaveLength(0);
  });

  it("never merges over a red combined status", async () => {
    const calls = await run({
      autoMergeError: "Pull request is in clean status",
      combinedStatus: { state: "failure", total_count: 2 },
    });
    expect(calls.merges).toHaveLength(0);
  });

  it("stops when auto-merge is already enabled", async () => {
    const calls = await run({ autoMergeError: "Auto merge already enabled" });
    expect(calls.merges).toHaveLength(0);
    expect(calls.paginated).not.toContain("listForRef");
  });

  it("stops on an unrecognized auto-merge error", async () => {
    const calls = await run({ autoMergeError: "Something exploded" });
    expect(calls.merges).toHaveLength(0);
  });

  it("swallows a merge race (405/409)", async () => {
    const calls = await run({
      autoMergeError: "Pull request is in clean status",
      mergeError: 409,
    });
    expect(calls.merges).toHaveLength(1);
  });

  it("leaves majors alone", async () => {
    const calls = await run({ pr: { title: "Bump react from 18.0.0 to 19.0.0" } });
    expect(calls.approvals).toHaveLength(0);
    expect(calls.graphql).toHaveLength(0);
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
    expect(calls.graphql).toHaveLength(0);
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
