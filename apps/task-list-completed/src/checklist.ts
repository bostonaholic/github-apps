// Orchestration: gather every markdown source on a PR, compute the task
// state, and sync the commit status and sticky comment.

import type { Context } from "probot";
import {
  hasDisableMarker,
  hasIgnoreMarker,
  isStickyComment,
  parseTasks,
} from "./parse.js";
import {
  buildStatus,
  buildStickyBody,
  DISABLE_LABEL,
  STATUS_CONTEXT,
  type OutstandingItem,
  type SourceKind,
} from "./format.js";

type Octokit = Context["octokit"];

export interface CheckParams {
  owner: string;
  repo: string;
  pull_number: number;
  // false when the repo config (.github/task-list.yml) disables the app
  enabled: boolean;
}

interface Source {
  kind: SourceKind;
  url: string;
  body: string;
  createdAt: string;
}

export async function runCheck(
  octokit: Octokit,
  params: CheckParams,
): Promise<void> {
  const { owner, repo, pull_number } = params;

  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number });
  if (pr.state !== "open") return;

  const disabled =
    !params.enabled ||
    hasDisableMarker(pr.body ?? "") ||
    pr.labels.some((label) => label.name === DISABLE_LABEL);

  // Issue comments are needed even when disabled, to find and remove the
  // sticky comment.
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pull_number,
    per_page: 100,
  });
  const sticky = comments.find((c) => isStickyComment(c.body ?? ""));

  let total = 0;
  const outstanding: OutstandingItem[] = [];

  if (!disabled) {
    const sources: Source[] = [];
    if (pr.body) {
      sources.push({
        kind: "description",
        url: pr.html_url,
        body: pr.body,
        createdAt: "",
      });
    }

    const rest: Source[] = [];
    for (const comment of comments) {
      if (!comment.body || isStickyComment(comment.body)) continue;
      rest.push({
        kind: "comment",
        url: comment.html_url,
        body: comment.body,
        createdAt: comment.created_at,
      });
    }

    const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number,
      per_page: 100,
    });
    for (const review of reviews) {
      if (!review.body) continue;
      rest.push({
        kind: "review",
        url: review.html_url,
        body: review.body,
        createdAt: review.submitted_at ?? "",
      });
    }

    const reviewComments = await octokit.paginate(
      octokit.rest.pulls.listReviewComments,
      { owner, repo, pull_number, per_page: 100 },
    );
    for (const comment of reviewComments) {
      rest.push({
        kind: "review comment",
        url: comment.html_url,
        body: comment.body,
        createdAt: comment.created_at,
      });
    }

    rest.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    sources.push(...rest);

    for (const source of sources) {
      if (hasIgnoreMarker(source.body)) continue;
      for (const task of parseTasks(source.body)) {
        total += 1;
        if (!task.checked) {
          outstanding.push({ text: task.text, url: source.url, source: source.kind });
        }
      }
    }
  }

  const stickyBody =
    disabled || total === 0 ? null : buildStickyBody(outstanding, total);
  const stickyUrl = await syncStickyComment(
    octokit,
    params,
    sticky ? { id: sticky.id, body: sticky.body ?? "", html_url: sticky.html_url } : null,
    stickyBody,
  );

  const status = buildStatus({ disabled, total, outstanding: outstanding.length });
  await octokit.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: pr.head.sha,
    context: STATUS_CONTEXT,
    state: status.state,
    description: status.description,
    ...(stickyUrl ? { target_url: stickyUrl } : {}),
  });
}

async function syncStickyComment(
  octokit: Octokit,
  { owner, repo, pull_number }: CheckParams,
  existing: { id: number; body: string; html_url: string } | null,
  body: string | null,
): Promise<string | null> {
  if (body === null) {
    if (existing) {
      await octokit.rest.issues.deleteComment({ owner, repo, comment_id: existing.id });
    }
    return null;
  }
  if (existing) {
    if (existing.body !== body) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body,
      });
    }
    return existing.html_url;
  }
  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pull_number,
    body,
  });
  return data.html_url;
}
