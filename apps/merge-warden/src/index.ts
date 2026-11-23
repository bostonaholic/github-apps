import Anthropic from "@anthropic-ai/sdk";
import { waitUntil } from "@vercel/functions";
import type { Context, Probot } from "probot";
import {
  NO_AUTO_MERGE_LABEL,
  ONE_WAY_DOOR_LABEL,
  normalizeConfig,
} from "./config.js";
import { UNKNOWN_MODEL_REPLY, canGrade, parseCommand } from "./command.js";
import { reconcile, type Mode } from "./gate.js";

const CONFIG_FILE = "merge-warden.yml";

type ReconcileEvent =
  | "pull_request"
  | "pull_request_review"
  | "check_suite"
  | "check_run"
  | "status"
  | "issue_comment";

interface Identity {
  appId: number;
  botLogin: string;
}

// Who this app is, asked of GitHub once per process. A failed lookup is
// not cached, so the next event asks again.
function identityOf(app: Probot): () => Promise<Identity> {
  let cached: Promise<Identity> | undefined;
  return () => {
    cached ??= app
      .auth()
      .then((octokit) => octokit.rest.apps.getAuthenticated())
      .then(({ data }) => {
        if (!data) throw new Error("GitHub returned no app for these credentials");
        return { appId: data.id, botLogin: `${data.slug}[bot]` };
      })
      .catch((error: unknown) => {
        cached = undefined;
        throw error;
      });
    return cached;
  };
}

// One client per process, built on first use. The timeout and single
// retry keep the worst case inside the function's maxDuration.
let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic({ timeout: 100_000, maxRetries: 1 }));

export default (app: Probot) => {
  const identity = identityOf(app);

  // Reads `.github/merge-warden.yml` from the repo's default branch (Probot
  // also falls back to the owner's .github repo). Never read from the PR
  // head, so a PR cannot change the policy that grades it.
  async function run(
    context: Context<ReconcileEvent>,
    pull_number: number,
    mode: Mode,
    model?: string,
  ): Promise<void> {
    const work = (async () => {
      const { owner, repo } = context.repo();
      const raw = await context.config(CONFIG_FILE);
      await reconcile(context.octokit, {
        owner,
        repo,
        pull_number,
        mode,
        config: normalizeConfig(raw as Record<string, unknown> | null, owner),
        ...(await identity()),
        anthropic,
        ...(model === undefined ? {} : { model }),
        log: context.log,
      });
    })();
    // A grade can outlast the 9 s after which the webhook middleware
    // answers GitHub. waitUntil keeps the Vercel invocation alive until
    // the work settles; it does nothing outside Vercel.
    waitUntil(work.catch(() => {}));
    await work;
  }

  // A new head commit, or a PR entering review: grade it.
  app.on(
    [
      "pull_request.opened",
      "pull_request.reopened",
      "pull_request.synchronize",
      "pull_request.ready_for_review",
    ],
    async (context) => {
      await run(context, context.payload.pull_request.number, "grade");
    },
  );

  // Retargeting changes the diff without changing the head commit.
  app.on("pull_request.edited", async (context) => {
    if (!context.payload.changes.base) return;
    await run(context, context.payload.pull_request.number, "grade");
  });

  // Only the app's two labels change the verdict.
  app.on(["pull_request.labeled", "pull_request.unlabeled"], async (context) => {
    const label = context.payload.label?.name;
    if (label !== ONE_WAY_DOOR_LABEL && label !== NO_AUTO_MERGE_LABEL) return;
    await run(context, context.payload.pull_request.number, "regrade");
  });

  app.on("pull_request.converted_to_draft", async (context) => {
    await run(context, context.payload.pull_request.number, "act");
  });

  app.on(
    ["pull_request_review.submitted", "pull_request_review.dismissed"],
    async (context) => {
      await run(context, context.payload.pull_request.number, "act");
    },
  );

  // The "green later" path for Actions and other check-run CI.
  app.on("check_suite.completed", async (context) => {
    for (const pr of context.payload.check_suite.pull_requests) {
      await run(context, pr.number, "act");
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
      await run(context, pr.number, "act");
    }
  });

  // "Re-run" on the app's own check: GitHub delivers this only to the app
  // that owns the check run.
  app.on("check_run.rerequested", async (context) => {
    for (const pr of context.payload.check_run.pull_requests) {
      await run(context, pr.number, "regrade");
    }
  });

  // `/merge-warden grade [model]` on a pull request: grade the head commit
  // again, like "Re-run", with the default model or the one named. The
  // newest grade is the verdict, so this takes write access.
  app.on("issue_comment.created", async (context) => {
    const { issue, comment } = context.payload;
    const user = comment.user;
    if (!issue.pull_request || user === null || user.type === "Bot") return;
    const command = parseCommand(comment.body);
    if (command === null) return;

    // Acknowledge first: the reaction request starts before the
    // permission lookup, and is removed if the commenter cannot grade.
    const reaction = context.octokit.rest.reactions
      .createForIssueComment(context.repo({ comment_id: comment.id, content: "eyes" }))
      .then(({ data }) => data.id)
      .catch((error: unknown) => {
        context.log.warn({ err: error }, `${issue.number}: could not react to grade command`);
        return null;
      });

    const { data } = await context.octokit.rest.repos.getCollaboratorPermissionLevel({
      ...context.repo(),
      username: user.login,
    });
    if (!canGrade(data.permission)) {
      context.log.info(
        `${issue.number}: ignoring grade command from ${user.login} (${data.permission})`,
      );
      const reaction_id = await reaction;
      if (reaction_id !== null) {
        await context.octokit.rest.reactions
          .deleteForIssueComment(context.repo({ comment_id: comment.id, reaction_id }))
          .catch((error: unknown) =>
            context.log.warn({ err: error }, `${issue.number}: could not remove reaction`),
          );
      }
      return;
    }

    if (command.kind === "unknown-model") {
      await context.octokit.rest.issues.createComment(
        context.issue({ body: UNKNOWN_MODEL_REPLY }),
      );
      await reaction;
      return;
    }
    await run(context, issue.number, "regrade", command.model ?? undefined);
  });
};
