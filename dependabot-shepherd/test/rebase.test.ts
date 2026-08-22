import { describe, expect, it } from "vitest";
import { DEFAULTS, normalizeConfig } from "../src/policy.js";
import { rebaseStalePRs, REBASE_COMMAND } from "../src/rebase.js";

interface FakePr {
  number: number;
  user?: { login: string; type: string };
  head?: { ref: string; sha: string };
  draft?: boolean;
  labels?: { name: string }[];
  mergeable_state?: string;
}

interface FakeOptions {
  prs?: FakePr[];
  comments?: Record<number, { user: { type: string }; body: string; created_at: string }[]>;
  headCommittedAt?: string;
  // Per-PR sequence of mergeable_state values across successive gets.
  mergeableSequence?: Record<number, string[]>;
}

function fakeOctokit(options: FakeOptions = {}) {
  const calls = { comments: [] as Record<string, unknown>[] };
  const gets = new Map<number, number>();

  const prs = (options.prs ?? []).map((pr) => ({
    user: { login: "dependabot[bot]", type: "Bot" },
    head: { ref: `dependabot/npm_and_yarn/pkg-${pr.number}`, sha: `sha${pr.number}` },
    draft: false,
    labels: [],
    mergeable_state: "behind",
    ...pr,
  }));

  const octokit = {
    rest: {
      pulls: {
        list: "list",
        get: async ({ pull_number }: { pull_number: number }) => {
          const attempt = gets.get(pull_number) ?? 0;
          gets.set(pull_number, attempt + 1);
          const pr = prs.find((p) => p.number === pull_number);
          const sequence = options.mergeableSequence?.[pull_number];
          if (pr && sequence) {
            const state = sequence[Math.min(attempt, sequence.length - 1)];
            return { data: { ...pr, mergeable_state: state } };
          }
          return { data: pr };
        },
      },
      issues: {
        listComments: "listComments",
        createComment: async (params: Record<string, unknown>) => {
          calls.comments.push(params);
          return {};
        },
      },
      repos: {
        getCommit: async () => ({
          data: {
            commit: {
              committer: { date: options.headCommittedAt ?? "2026-08-22T00:00:00Z" },
            },
          },
        }),
      },
    },
    paginate: async (route: unknown, params?: { issue_number?: number }) => {
      if (route === "list") return prs;
      if (route === "listComments") {
        return options.comments?.[params?.issue_number ?? 0] ?? [];
      }
      throw new Error(`unexpected paginate route: ${String(route)}`);
    },
  };

  return { octokit, calls };
}

const params = { owner: "o", repo: "r", config: DEFAULTS, retryDelayMs: 0 };

async function run(
  options: FakeOptions = {},
  overrides: Partial<typeof params & { allowAuthor: string }> = {},
) {
  const { octokit, calls } = fakeOctokit(options);
  await rebaseStalePRs(octokit as never, { ...params, ...overrides });
  return calls;
}

describe("rebaseStalePRs", () => {
  it("comments on behind and conflicted dependabot PRs", async () => {
    const calls = await run({
      prs: [
        { number: 1, mergeable_state: "behind" },
        { number: 2, mergeable_state: "dirty" },
        { number: 3, mergeable_state: "clean" },
      ],
    });
    expect(calls.comments).toEqual([
      expect.objectContaining({ issue_number: 1, body: REBASE_COMMAND }),
      expect.objectContaining({ issue_number: 2, body: REBASE_COMMAND }),
    ]);
  });

  it("ignores PRs not authored by dependabot", async () => {
    const calls = await run({
      prs: [{ number: 1, user: { login: "alice", type: "User" } }],
    });
    expect(calls.comments).toHaveLength(0);
  });

  it("accepts the e2e allowAuthor seam", async () => {
    const calls = await run(
      { prs: [{ number: 1, user: { login: "matthew", type: "User" } }] },
      { allowAuthor: "matthew" },
    );
    expect(calls.comments).toHaveLength(1);
  });

  it("skips drafts and the ignore label", async () => {
    const calls = await run({
      prs: [
        { number: 1, draft: true },
        { number: 2, labels: [{ name: "shepherd: ignore" }] },
      ],
    });
    expect(calls.comments).toHaveLength(0);
  });

  it("does not ask twice while dependabot is still rebasing the same head", async () => {
    const calls = await run({
      prs: [{ number: 1 }],
      comments: {
        1: [
          {
            user: { type: "Bot" },
            body: REBASE_COMMAND,
            created_at: "2026-08-22T12:00:00Z",
          },
        ],
      },
      headCommittedAt: "2026-08-22T10:00:00Z",
    });
    expect(calls.comments).toHaveLength(0);
  });

  it("asks again once dependabot pushed a newer head", async () => {
    const calls = await run({
      prs: [{ number: 1 }],
      comments: {
        1: [
          {
            user: { type: "Bot" },
            body: REBASE_COMMAND,
            created_at: "2026-08-22T10:00:00Z",
          },
        ],
      },
      headCommittedAt: "2026-08-22T12:00:00Z",
    });
    expect(calls.comments).toHaveLength(1);
  });

  it("retries through an unknown mergeable_state", async () => {
    const calls = await run({
      prs: [{ number: 1 }],
      mergeableSequence: { 1: ["unknown", "behind"] },
    });
    expect(calls.comments).toHaveLength(1);
  });

  it("gives up on a persistently unknown mergeable_state", async () => {
    const calls = await run({
      prs: [{ number: 1 }],
      mergeableSequence: { 1: ["unknown"] },
    });
    expect(calls.comments).toHaveLength(0);
  });

  it("does nothing when rebasing is disabled", async () => {
    const calls = await run(
      { prs: [{ number: 1 }] },
      { config: normalizeConfig({ rebase: false }) },
    );
    expect(calls.comments).toHaveLength(0);
  });
});
