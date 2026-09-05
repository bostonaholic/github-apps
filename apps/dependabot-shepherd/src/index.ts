import type { Context, Probot } from "probot";
import { IGNORE_LABEL, normalizeConfig, type ShepherdConfig } from "./policy.js";
import { rebaseStalePRs } from "./rebase.js";
import { reconcile } from "./shepherd.js";

const CONFIG_FILE = "dependabot-shepherd.yml";

type ReconcileEvent = "pull_request" | "check_suite" | "status";

async function getConfig(
  context: Context<ReconcileEvent | "push">,
): Promise<ShepherdConfig> {
  const raw = await context.config(CONFIG_FILE);
  return normalizeConfig(raw as Record<string, unknown> | null);
}

async function run(
  context: Context<ReconcileEvent>,
  pull_number: number,
): Promise<void> {
  await reconcile(context.octokit, {
    ...context.repo(),
    pull_number,
    config: await getConfig(context),
    allowAuthor: process.env.E2E_ALLOW_AUTHOR,
    log: context.log,
  });
}

export default (app: Probot) => {
  app.on(
    [
      "pull_request.opened",
      "pull_request.reopened",
      "pull_request.synchronize",
      "pull_request.ready_for_review",
    ],
    async (context) => {
      await run(context, context.payload.pull_request.number);
    },
  );

  app.on(["pull_request.labeled", "pull_request.unlabeled"], async (context) => {
    // Dependabot itself labels every PR it opens; only the opt-out label
    // changes the decision, so only it re-triggers a run.
    if (context.payload.label?.name !== IGNORE_LABEL) return;
    await run(context, context.payload.pull_request.number);
  });

  // The "green later" path for Actions and other check-run CI.
  app.on("check_suite.completed", async (context) => {
    for (const pr of context.payload.check_suite.pull_requests) {
      await run(context, pr.number);
    }
  });

  // The "green later" path for legacy commit-status CI.
  app.on("status", async (context) => {
    if (context.payload.state === "pending") return;
    const { data: prs } =
      await context.octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        ...context.repo(),
        commit_sha: context.payload.sha,
      });
    for (const pr of prs) {
      if (pr.state !== "open") continue;
      await run(context, pr.number);
    }
  });

  app.on("push", async (context) => {
    const { ref, repository } = context.payload;
    if (ref !== `refs/heads/${repository.default_branch}`) return;
    await rebaseStalePRs(context.octokit, {
      ...context.repo(),
      config: await getConfig(context),
      allowAuthor: process.env.E2E_ALLOW_AUTHOR,
      log: context.log,
    });
  });
};
