import type { Context, Probot } from "probot";
import { normalizeConfig } from "./config.js";
import { reconcile } from "./reconcile.js";

const CONFIG_FILE = "fix-forward.yml";

type ReconcileEvent = "check_suite" | "status";

// This app's bot login, asked of GitHub once per process. A failed lookup
// is not cached, so the next event asks again.
function botLoginOf(app: Probot): () => Promise<string> {
  let cached: Promise<string> | undefined;
  return () => {
    cached ??= app
      .auth()
      .then((octokit) => octokit.rest.apps.getAuthenticated())
      .then(({ data }) => {
        if (!data) throw new Error("GitHub returned no app for these credentials");
        return `${data.slug}[bot]`;
      })
      .catch((error: unknown) => {
        cached = undefined;
        throw error;
      });
    return cached;
  };
}

export default (app: Probot) => {
  const botLogin = botLoginOf(app);

  // Reads `.github/fix-forward.yml` from the repo's default branch (Probot
  // also falls back to the owner's .github repo).
  async function run(context: Context<ReconcileEvent>, eventBranches: string[]) {
    const { owner, repo } = context.repo();
    const raw = await context.config(CONFIG_FILE);
    await reconcile(context.octokit, {
      owner,
      repo,
      repoUrl: context.payload.repository.html_url,
      defaultBranch: context.payload.repository.default_branch,
      eventBranches,
      config: normalizeConfig(raw as Record<string, unknown> | null),
      botLogin: await botLogin(),
      log: context.log,
    });
  }

  // Actions and other check-run CI, including a finished re-run.
  app.on("check_suite.completed", async (context) => {
    const branch = context.payload.check_suite.head_branch;
    await run(context, branch ? [branch] : []);
  });

  // Legacy commit-status CI.
  app.on("status", async (context) => {
    if (context.payload.state === "pending") return;
    await run(context, context.payload.branches.map((b) => b.name));
  });
};
