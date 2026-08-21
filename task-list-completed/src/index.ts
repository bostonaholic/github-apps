import type { Context, Probot } from "probot";
import { runCheck } from "./checklist.js";
import { isStickyComment } from "./parse.js";

const CONFIG_FILE = "task-list.yml";

async function run(
  context: Context<
    | "pull_request"
    | "issue_comment"
    | "pull_request_review"
    | "pull_request_review_comment"
  >,
  pull_number: number,
): Promise<void> {
  const config = await context.config(CONFIG_FILE, { enabled: true });
  await runCheck(context.octokit, {
    ...context.repo(),
    pull_number,
    enabled: config?.enabled !== false,
  });
}

export default (app: Probot) => {
  app.on(
    [
      "pull_request.opened",
      "pull_request.edited",
      "pull_request.reopened",
      "pull_request.synchronize",
      "pull_request.ready_for_review",
      "pull_request.labeled",
      "pull_request.unlabeled",
    ],
    async (context) => {
      await run(context, context.payload.pull_request.number);
    },
  );

  app.on(
    ["issue_comment.created", "issue_comment.edited", "issue_comment.deleted"],
    async (context) => {
      const { issue, comment } = context.payload;
      // Only comments on pull requests matter, and the bot's own sticky
      // comment must not re-trigger a run.
      if (!issue.pull_request) return;
      if (isStickyComment(comment.body ?? "")) return;
      await run(context, issue.number);
    },
  );

  app.on(
    [
      "pull_request_review.submitted",
      "pull_request_review.edited",
      "pull_request_review.dismissed",
    ],
    async (context) => {
      await run(context, context.payload.pull_request.number);
    },
  );

  app.on(
    [
      "pull_request_review_comment.created",
      "pull_request_review_comment.edited",
      "pull_request_review_comment.deleted",
    ],
    async (context) => {
      await run(context, context.payload.pull_request.number);
    },
  );
};
