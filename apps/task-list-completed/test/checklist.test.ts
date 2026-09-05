import { describe, expect, it } from "vitest";
import { runCheck } from "../src/checklist.js";
import { STICKY_MARKER } from "../src/format.js";

interface FakeOptions {
  pr?: Partial<{
    state: string;
    body: string | null;
    labels: { name: string }[];
  }>;
  comments?: { id: number; body: string; html_url: string; created_at: string }[];
  reviews?: { body: string | null; html_url: string; submitted_at: string }[];
  reviewComments?: { body: string; html_url: string; created_at: string }[];
}

function fakeOctokit(options: FakeOptions = {}) {
  const calls = {
    statuses: [] as Record<string, unknown>[],
    created: [] as Record<string, unknown>[],
    updated: [] as Record<string, unknown>[],
    deleted: [] as Record<string, unknown>[],
    paginated: [] as string[],
  };

  const pr = {
    state: "open",
    body: null as string | null,
    labels: [] as { name: string }[],
    html_url: "https://github.com/o/r/pull/1",
    head: { sha: "abc123" },
    ...options.pr,
  };

  const octokit = {
    rest: {
      pulls: {
        get: async () => ({ data: pr }),
        listReviews: "listReviews",
        listReviewComments: "listReviewComments",
      },
      issues: {
        listComments: "listComments",
        createComment: async (params: Record<string, unknown>) => {
          calls.created.push(params);
          return { data: { html_url: "https://github.com/o/r/pull/1#issuecomment-999" } };
        },
        updateComment: async (params: Record<string, unknown>) => {
          calls.updated.push(params);
          return {};
        },
        deleteComment: async (params: Record<string, unknown>) => {
          calls.deleted.push(params);
          return {};
        },
      },
      repos: {
        createCommitStatus: async (params: Record<string, unknown>) => {
          calls.statuses.push(params);
          return {};
        },
      },
    },
    paginate: async (route: unknown) => {
      calls.paginated.push(route as string);
      if (route === "listComments") return options.comments ?? [];
      if (route === "listReviews") return options.reviews ?? [];
      if (route === "listReviewComments") return options.reviewComments ?? [];
      throw new Error(`unexpected paginate route: ${String(route)}`);
    },
  };

  return { octokit, calls };
}

const params = { owner: "o", repo: "r", pull_number: 1, enabled: true };

async function check(options: FakeOptions = {}, overrides: Partial<typeof params> = {}) {
  const { octokit, calls } = fakeOctokit(options);
  // The fake is structurally compatible with the narrow slice of octokit
  // that runCheck uses.
  await runCheck(octokit as never, { ...params, ...overrides });
  return calls;
}

describe("runCheck", () => {
  it("reports failure and posts a sticky comment while tasks are unchecked", async () => {
    const calls = await check({
      pr: { body: "- [ ] run migration\n- [x] done thing" },
      comments: [
        {
          id: 1,
          body: "- [ ] get sign-off",
          html_url: "https://github.com/o/r/pull/1#issuecomment-1",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    expect(calls.statuses).toEqual([
      expect.objectContaining({
        sha: "abc123",
        context: "task-list-completed",
        state: "failure",
        description: "2 of 3 tasks remaining",
        target_url: "https://github.com/o/r/pull/1#issuecomment-999",
      }),
    ]);
    expect(calls.created).toHaveLength(1);
    const body = calls.created[0].body as string;
    expect(body).toContain(STICKY_MARKER);
    expect(body).toContain("[run migration](https://github.com/o/r/pull/1)");
    expect(body).toContain("[get sign-off](https://github.com/o/r/pull/1#issuecomment-1)");
  });

  it("counts tasks from reviews and review comments", async () => {
    const calls = await check({
      reviews: [
        {
          body: "- [ ] fix the naming",
          html_url: "https://github.com/o/r/pull/1#pullrequestreview-5",
          submitted_at: "2026-01-01T00:00:00Z",
        },
        { body: null, html_url: "https://x", submitted_at: "2026-01-02T00:00:00Z" },
      ],
      reviewComments: [
        {
          body: "- [ ] add a test here",
          html_url: "https://github.com/o/r/pull/1#discussion_r7",
          created_at: "2026-01-03T00:00:00Z",
        },
      ],
    });

    expect(calls.statuses[0].description).toBe("2 of 2 tasks remaining");
    const body = calls.created[0].body as string;
    expect(body).toContain("#pullrequestreview-5) — *review*");
    expect(body).toContain("#discussion_r7) — *review comment*");
  });

  it("reports success and updates the sticky comment when all tasks are checked", async () => {
    const calls = await check({
      pr: { body: "- [x] run migration" },
      comments: [
        {
          id: 9,
          body: `${STICKY_MARKER}\nold body`,
          html_url: "https://github.com/o/r/pull/1#issuecomment-9",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    expect(calls.statuses[0]).toMatchObject({
      state: "success",
      description: "All 1 task complete",
      target_url: "https://github.com/o/r/pull/1#issuecomment-9",
    });
    expect(calls.updated).toHaveLength(1);
    expect(calls.updated[0].comment_id).toBe(9);
    expect(calls.updated[0].body).toContain("all 1 task complete");
  });

  it("leaves the sticky comment alone when its body is unchanged", async () => {
    const first = await check({ pr: { body: "- [ ] task" } });
    const stickyBody = first.created[0].body as string;

    const second = await check({
      pr: { body: "- [ ] task" },
      comments: [
        {
          id: 9,
          body: stickyBody,
          html_url: "https://github.com/o/r/pull/1#issuecomment-9",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(second.created).toHaveLength(0);
    expect(second.updated).toHaveLength(0);
    expect(second.deleted).toHaveLength(0);
  });

  it("succeeds and deletes the sticky comment when no tasks exist", async () => {
    const calls = await check({
      pr: { body: "just a description" },
      comments: [
        {
          id: 9,
          body: `${STICKY_MARKER}\nstale`,
          html_url: "https://x",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    expect(calls.statuses[0]).toMatchObject({
      state: "success",
      description: "No tasks found",
    });
    expect(calls.statuses[0].target_url).toBeUndefined();
    expect(calls.deleted).toEqual([expect.objectContaining({ comment_id: 9 })]);
  });

  it("skips checkbox sources marked with the ignore marker", async () => {
    const calls = await check({
      pr: { body: "- [ ] gated task" },
      comments: [
        {
          id: 1,
          body: "<!-- task-list: ignore -->\n- [ ] just a note",
          html_url: "https://x",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(calls.statuses[0].description).toBe("1 of 1 task remaining");
  });

  it("disables the gate via the description marker", async () => {
    const calls = await check({
      pr: { body: "<!-- task-list: disable -->\n- [ ] not a gate" },
    });
    expect(calls.statuses[0]).toMatchObject({
      state: "success",
      description: "Task list checks are disabled",
    });
    expect(calls.created).toHaveLength(0);
    // Reviews are never fetched when disabled.
    expect(calls.paginated).toEqual(["listComments"]);
  });

  it("disables the gate via the label", async () => {
    const calls = await check({
      pr: { body: "- [ ] task", labels: [{ name: "task-list: disabled" }] },
    });
    expect(calls.statuses[0].state).toBe("success");
  });

  it("disables the gate via repo config and removes the sticky comment", async () => {
    const calls = await check(
      {
        pr: { body: "- [ ] task" },
        comments: [
          {
            id: 9,
            body: `${STICKY_MARKER}\nstale`,
            html_url: "https://x",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
      { enabled: false },
    );
    expect(calls.statuses[0].state).toBe("success");
    expect(calls.deleted).toHaveLength(1);
  });

  it("excludes its own sticky comment from task counting", async () => {
    const calls = await check({
      pr: { body: "- [x] done" },
      comments: [
        {
          id: 9,
          // A stale sticky body; its markdown must not be counted as tasks.
          body: `${STICKY_MARKER}\n- [ ] leftover looking line`,
          html_url: "https://x",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(calls.statuses[0].description).toBe("All 1 task complete");
  });

  it("does nothing for a closed pull request", async () => {
    const calls = await check({ pr: { state: "closed", body: "- [ ] task" } });
    expect(calls.statuses).toHaveLength(0);
    expect(calls.paginated).toHaveLength(0);
  });
});
