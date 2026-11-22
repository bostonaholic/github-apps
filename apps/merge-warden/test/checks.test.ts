import { describe, expect, it } from "vitest";
import { checksRollup } from "../src/checks.js";

const APP_ID = 4242;
const CI_APP = { id: 15368 };

interface FakeRun {
  // GitHub assigns ids in creation order. Default: position in the list.
  id?: number;
  // Default: unique per position, so unnamed runs stay distinct checks.
  name?: string;
  status: string;
  conclusion: string | null;
  app?: { id: number } | null;
}

interface FakeOptions {
  checkRuns?: FakeRun[];
  statuses?: { context: string; state: string }[];
  // The repo's `ci_checks`. Default: one check named "test".
  ciChecks?: string[];
}

function fakeOctokit(options: FakeOptions = {}) {
  const calls = { statusPages: [] as number[], listForRef: [] as Record<string, unknown>[] };
  const all = options.statuses ?? [];

  const octokit = {
    rest: {
      checks: { listForRef: "listForRef" },
      repos: {
        // GitHub defaults this endpoint to 30 statuses per page. Slice so a
        // test can put a decisive status past the first page.
        getCombinedStatusForRef: async (
          params: { page?: number; per_page?: number } = {},
        ) => {
          const page = params.page ?? 1;
          calls.statusPages.push(page);
          const perPage = params.per_page ?? 30;
          const start = (page - 1) * perPage;
          return {
            data: { total_count: all.length, statuses: all.slice(start, start + perPage) },
          };
        },
      },
    },
    paginate: async (route: unknown, params: Record<string, unknown>) => {
      if (route !== "listForRef") throw new Error(`unexpected route: ${String(route)}`);
      calls.listForRef.push(params);
      return (options.checkRuns ?? []).map((run, i) => ({
        id: i + 1,
        name: `check-${i + 1}`,
        ...run,
      }));
    },
  };

  return { octokit, calls };
}

async function rollup(options: FakeOptions = {}) {
  const { octokit, calls } = fakeOctokit(options);
  const result = await checksRollup(octokit as never, {
    owner: "o",
    repo: "r",
    ref: "head1",
    appId: APP_ID,
    ciChecks: options.ciChecks ?? ["test"],
  });
  return { result, calls };
}

const passed: FakeRun = { name: "test", status: "completed", conclusion: "success", app: CI_APP };

describe("checksRollup", () => {
  it("is green when the named CI check succeeded and nothing else reported", async () => {
    expect((await rollup({ checkRuns: [passed] })).result).toBe("green");
  });

  describe("named CI checks", () => {
    const lint: FakeRun = { name: "lint", status: "completed", conclusion: "success", app: CI_APP };
    const deployBot: FakeRun = {
      name: "Vercel Preview Comments",
      status: "completed",
      conclusion: "success",
      app: { id: 8329 },
    };

    it("is never green with no names configured, even when everything succeeded", async () => {
      const { result } = await rollup({ checkRuns: [passed, lint, deployBot], ciChecks: [] });
      expect(result).toBe("pending");
    });

    it("does not count a deploy bot's success as CI", async () => {
      expect((await rollup({ checkRuns: [deployBot] })).result).toBe("pending");
      expect(
        (
          await rollup({
            checkRuns: [deployBot],
            statuses: [{ context: "Vercel – my-app", state: "success" }],
          })
        ).result,
      ).toBe("pending");
    });

    it("needs every named check, not just one", async () => {
      const ciChecks = ["test", "lint"];
      expect((await rollup({ checkRuns: [passed], ciChecks })).result).toBe("pending");
      expect((await rollup({ checkRuns: [passed, lint], ciChecks })).result).toBe("green");
    });

    it("accepts a commit-status context as a named check", async () => {
      const { result } = await rollup({
        statuses: [{ context: "ci/legacy", state: "success" }],
        ciChecks: ["ci/legacy"],
      });
      expect(result).toBe("green");
    });

    it("still turns red on a failing check that is not named", async () => {
      const { result } = await rollup({
        checkRuns: [passed, { ...deployBot, conclusion: "failure" }],
      });
      expect(result).toBe("red");
    });

    it("still waits on a running check that is not named", async () => {
      const { result } = await rollup({
        checkRuns: [passed, { ...deployBot, status: "in_progress", conclusion: null }],
      });
      expect(result).toBe("pending");
    });

    it("does not let a skipped or neutral run satisfy a name", async () => {
      for (const conclusion of ["skipped", "neutral"]) {
        const { result } = await rollup({ checkRuns: [{ ...passed, conclusion }] });
        expect(result).toBe("pending");
      }
    });
  });

  describe("runs of the same check", () => {
    // One commit, one workflow, three triggers (opened, labeled,
    // unlabeled): GitHub keeps every run, each in its own check suite.
    const failed: FakeRun = { ...passed, conclusion: "failure" };

    it("ignore a failed run superseded by a newer success", async () => {
      const { result } = await rollup({
        checkRuns: [
          { ...failed, id: 1 },
          { ...passed, id: 2 },
          { ...passed, id: 3 },
        ],
      });
      expect(result).toBe("green");
    });

    it("pick the newest by id, not by list order", async () => {
      const { result } = await rollup({
        checkRuns: [
          { ...passed, id: 2 },
          { ...failed, id: 1 },
        ],
      });
      expect(result).toBe("green");
    });

    it("are red when the newest run failed", async () => {
      const { result } = await rollup({
        checkRuns: [
          { ...passed, id: 1 },
          { ...failed, id: 2 },
        ],
      });
      expect(result).toBe("red");
    });

    it("are pending while the newest run is still running", async () => {
      const { result } = await rollup({
        checkRuns: [
          { ...failed, id: 1 },
          { ...passed, id: 2, status: "in_progress", conclusion: null },
        ],
      });
      expect(result).toBe("pending");
    });

    it("are told apart by app: another app's newer success hides no failure", async () => {
      const { result } = await rollup({
        checkRuns: [
          { ...failed, id: 1 },
          { ...passed, id: 2, app: { id: 8329 } },
        ],
      });
      expect(result).toBe("red");
    });
  });

  it("reads every check run on the commit, not only its own", async () => {
    const { calls } = await rollup({ checkRuns: [passed] });
    expect(calls.listForRef).toEqual([{ owner: "o", repo: "r", ref: "head1", per_page: 100 }]);
  });

  it("is pending with no check runs and no statuses: no CI is never green", async () => {
    expect((await rollup()).result).toBe("pending");
  });

  it("is pending while a check run is queued or in progress", async () => {
    for (const status of ["queued", "in_progress"]) {
      const { result } = await rollup({
        checkRuns: [passed, { status, conclusion: null, app: CI_APP }],
      });
      expect(result).toBe("pending");
    }
  });

  it.each(["failure", "cancelled", "timed_out", "action_required", "stale"])(
    "is red when a check run concluded %s",
    async (conclusion) => {
      const { result } = await rollup({
        checkRuns: [passed, { status: "completed", conclusion, app: CI_APP }],
      });
      expect(result).toBe("red");
    },
  );

  it("is red over pending when both are present", async () => {
    const { result } = await rollup({
      checkRuns: [
        { status: "in_progress", conclusion: null, app: CI_APP },
        { status: "completed", conclusion: "failure", app: CI_APP },
      ],
    });
    expect(result).toBe("red");
  });

  it("lets skipped and neutral runs pass without counting them as success", async () => {
    const quiet: FakeRun[] = [
      { status: "completed", conclusion: "skipped", app: CI_APP },
      { status: "completed", conclusion: "neutral", app: CI_APP },
    ];
    expect((await rollup({ checkRuns: quiet })).result).toBe("pending");
    expect((await rollup({ checkRuns: [...quiet, passed] })).result).toBe("green");
  });

  describe("its own check run", () => {
    it("is ignored while in progress, so the app does not wait on itself", async () => {
      const { result } = await rollup({
        checkRuns: [
          passed,
          { name: "merge-warden", status: "in_progress", conclusion: null, app: { id: APP_ID } },
        ],
      });
      expect(result).toBe("green");
    });

    it("cannot satisfy a named check, even when the repo names it", async () => {
      const own: FakeRun = {
        name: "merge-warden",
        status: "completed",
        conclusion: "success",
        app: { id: APP_ID },
      };
      expect((await rollup({ checkRuns: [own] })).result).toBe("pending");
      expect((await rollup({ checkRuns: [own], ciChecks: ["merge-warden"] })).result).toBe(
        "pending",
      );
    });

    it("is matched by app id: another app's run with the same name still counts", async () => {
      const { result } = await rollup({
        checkRuns: [
          { name: "merge-warden", status: "completed", conclusion: "failure", app: CI_APP },
        ],
      });
      expect(result).toBe("red");
    });
  });

  describe("commit statuses", () => {
    it("are not enough for green when they are not a named check", async () => {
      const { result } = await rollup({
        statuses: [{ context: "task-list-completed", state: "success" }],
      });
      expect(result).toBe("pending");
    });

    it("hold a green check run at pending while a status is pending", async () => {
      const { result } = await rollup({
        checkRuns: [passed],
        statuses: [{ context: "ci/legacy", state: "pending" }],
      });
      expect(result).toBe("pending");
    });

    it.each(["failure", "error"])("turn the rollup red on %s", async (state) => {
      const { result } = await rollup({
        checkRuns: [passed],
        statuses: [{ context: "ci/legacy", state }],
      });
      expect(result).toBe("red");
    });

    it("are read past the first page", async () => {
      const statuses = [
        ...Array.from({ length: 100 }, (_, i) => ({ context: `ok-${i}`, state: "success" })),
        { context: "late", state: "failure" },
      ];
      const { result, calls } = await rollup({ checkRuns: [passed], statuses });
      expect(calls.statusPages).toEqual([1, 2]);
      expect(result).toBe("red");
    });
  });
});
