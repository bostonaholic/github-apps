import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../src/config.js";
import { reconcile, type Mode } from "../src/gate.js";

interface FakeOptions {
  pr?: Record<string, unknown>;
}

function fakeOctokit(options: FakeOptions = {}) {
  const calls = { gets: 0 };

  const pr = {
    state: "open",
    draft: false,
    labels: [] as { name: string }[],
    user: { login: "owner", type: "User" },
    head: { sha: "head1", ref: "feature", repo: { full_name: "owner/r" } },
    base: { sha: "base1", ref: "main", repo: { full_name: "owner/r", default_branch: "main" } },
    node_id: "PR_1",
    auto_merge: null,
    ...options.pr,
  };

  const octokit = {
    rest: {
      pulls: {
        get: async () => {
          calls.gets += 1;
          return { data: pr };
        },
      },
    },
  };

  return { octokit, calls };
}

const CONFIG = normalizeConfig(null, "owner");

async function run(
  options: FakeOptions = {},
  overrides: { mode?: Mode; config?: typeof CONFIG } = {},
) {
  const { octokit, calls } = fakeOctokit(options);
  // The fake is structurally compatible with the narrow slice of octokit
  // that reconcile uses.
  await reconcile(octokit as never, {
    owner: "owner",
    repo: "r",
    pull_number: 1,
    mode: overrides.mode ?? "grade",
    config: overrides.config ?? CONFIG,
  });
  return calls;
}

describe("reconcile", () => {
  it("does nothing, not even a fetch, when disabled", async () => {
    const calls = await run({}, { config: { ...CONFIG, enabled: false } });
    expect(calls.gets).toBe(0);
  });

  it("fetches the pull request when enabled", async () => {
    const calls = await run();
    expect(calls.gets).toBe(1);
  });
});
