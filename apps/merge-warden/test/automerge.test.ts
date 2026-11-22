import { describe, expect, it } from "vitest";
import { armAutoMerge, disarmAutoMerge, requiresOwnCheck } from "../src/automerge.js";

const APP_ID = 4242;

interface RequiredCheck {
  context: string;
  app_id: number | null;
}

function fakeOctokit(
  options: { graphqlError?: Error; protection?: unknown } = {},
) {
  const calls = {
    graphql: [] as { query: string; variables: Record<string, unknown> }[],
    branches: [] as Record<string, unknown>[],
  };
  const octokit = {
    graphql: async (query: string, variables: Record<string, unknown>) => {
      calls.graphql.push({ query, variables });
      if (options.graphqlError) throw options.graphqlError;
      return {};
    },
    rest: {
      repos: {
        getBranch: async (params: Record<string, unknown>) => {
          calls.branches.push(params);
          return { data: { name: params.branch, protection: options.protection } };
        },
      },
    },
  };
  return { octokit, calls };
}

const ARM = { pullRequestId: "PR_1", mergeMethod: "squash" as const, head: "head1" };

describe("armAutoMerge", () => {
  it("enables auto-merge pinned to the graded commit", async () => {
    const { octokit, calls } = fakeOctokit();
    const outcome = await armAutoMerge(octokit as never, ARM);
    expect(outcome).toEqual({ armed: true });
    expect(calls.graphql).toHaveLength(1);
    expect(calls.graphql[0].query).toContain("enablePullRequestAutoMerge");
    expect(calls.graphql[0].variables).toEqual({
      id: "PR_1",
      mergeMethod: "SQUASH",
      expectedHeadOid: "head1",
    });
  });

  it.each([
    ["squash", "SQUASH"],
    ["merge", "MERGE"],
    ["rebase", "REBASE"],
  ] as const)("maps merge method %s to %s", async (mergeMethod, expected) => {
    const { octokit, calls } = fakeOctokit();
    await armAutoMerge(octokit as never, { ...ARM, mergeMethod });
    expect(calls.graphql[0].variables.mergeMethod).toBe(expected);
  });

  it("counts an already-enabled auto-merge as armed", async () => {
    const { octokit } = fakeOctokit({
      graphqlError: new Error("Pull request Auto merge is already enabled"),
    });
    expect(await armAutoMerge(octokit as never, ARM)).toEqual({ armed: true });
  });

  it.each([
    "Pull request Pull request is in clean status",
    "Pull request Pull request is in unstable status",
    "Pull request Auto merge is not allowed for this repository",
    "Pull request Protected branch rules not configured for this branch",
    "Resource not accessible by integration",
    "Head sha didn't match expected head sha.",
    "something GitHub has never said before",
  ])("reports a refusal with its reason, without throwing: %s", async (message) => {
    const { octokit } = fakeOctokit({ graphqlError: new Error(message) });
    expect(await armAutoMerge(octokit as never, ARM)).toEqual({ armed: false, why: message });
  });
});

describe("disarmAutoMerge", () => {
  it("disables auto-merge on the pull request", async () => {
    const { octokit, calls } = fakeOctokit();
    await disarmAutoMerge(octokit as never, "PR_1");
    expect(calls.graphql).toHaveLength(1);
    expect(calls.graphql[0].query).toContain("disablePullRequestAutoMerge");
    expect(calls.graphql[0].variables).toEqual({ id: "PR_1" });
  });

  it("throws when GitHub refuses, so the caller cannot carry on armed", async () => {
    const boom = new Error("server error");
    const { octokit } = fakeOctokit({ graphqlError: boom });
    await expect(disarmAutoMerge(octokit as never, "PR_1")).rejects.toBe(boom);
  });
});

describe("requiresOwnCheck", () => {
  const params = { owner: "o", repo: "r", branch: "main", checkName: "merge-warden", appId: APP_ID };
  const protection = (checks: RequiredCheck[], contexts: string[] = []) => ({
    enabled: true,
    required_status_checks: { contexts, checks },
  });
  const ask = async (value: unknown) => {
    const { octokit, calls } = fakeOctokit({ protection: value });
    return { result: await requiresOwnCheck(octokit as never, params), calls };
  };

  it("is true when the check is required and pinned to this app", async () => {
    const { result, calls } = await ask(
      protection([
        { context: "test", app_id: 15368 },
        { context: "merge-warden", app_id: APP_ID },
      ]),
    );
    expect(result).toBe(true);
    expect(calls.branches).toEqual([{ owner: "o", repo: "r", branch: "main" }]);
  });

  it("is false when the name is required from any source", async () => {
    expect((await ask(protection([{ context: "merge-warden", app_id: null }]))).result).toBe(false);
  });

  it("is false when the name is pinned to a different app", async () => {
    expect((await ask(protection([{ context: "merge-warden", app_id: 15368 }]))).result).toBe(false);
  });

  it("is false when only other checks are required", async () => {
    expect((await ask(protection([{ context: "test", app_id: APP_ID }]))).result).toBe(false);
  });

  it("is false for a legacy context entry with no app pin", async () => {
    expect((await ask(protection([], ["merge-warden"]))).result).toBe(false);
  });

  it("is false for a branch with no protection or no required checks", async () => {
    expect((await ask(undefined)).result).toBe(false);
    expect((await ask({ enabled: false })).result).toBe(false);
  });
});
