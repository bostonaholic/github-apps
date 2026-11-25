import { describe, expect, it } from "vitest";
import { closeStreakIssue, listStreakIssues, openStreakIssue, triggerAgentOnce } from "../src/issues.js";
import { AGENT_MARKER, LABEL, formatMarker } from "../src/report.js";
import { BOT, fakeGitHub } from "./fake-github.js";

const repo = { owner: "o", repo: "r" };
const marker = formatMarker({ base: "a1", reported: ["b2"] });

describe("openStreakIssue", () => {
  it("creates the label first, so the issue can be found again", async () => {
    const fake = fakeGitHub();
    const number = await openStreakIssue(fake.octokit, { ...repo, title: "t", body: marker });
    expect(fake.state.labels.has(LABEL)).toBe(true);
    expect(await listStreakIssues(fake.octokit, { ...repo, botLogin: BOT })).toEqual([
      { number, open: true, body: marker, marker: { base: "a1", reported: ["b2"] } },
    ]);
  });

  it("does not recreate an existing label", async () => {
    const fake = fakeGitHub({ labels: new Set([LABEL]) });
    await openStreakIssue(fake.octokit, { ...repo, title: "t", body: marker });
    expect(fake.state.calls).not.toContain("issues.createLabel");
  });
});

describe("listStreakIssues", () => {
  it("skips issues by others, pull requests, and bodies without the marker", async () => {
    const issue = { title: "t", state: "open" as const, labels: [{ name: LABEL }] };
    const fake = fakeGitHub({
      issues: [
        { ...issue, number: 1, body: marker, user: { login: BOT } },
        { ...issue, number: 2, body: marker, user: { login: "mallory" } },
        { ...issue, number: 3, body: marker, user: { login: BOT }, pull_request: {} },
        { ...issue, number: 4, body: "edited", user: { login: BOT } },
      ],
    });
    expect((await listStreakIssues(fake.octokit, { ...repo, botLogin: BOT })).map((i) => i.number)).toEqual([1]);
  });
});

describe("triggerAgentOnce", () => {
  it("posts the trigger comment once", async () => {
    const fake = fakeGitHub();
    const args = { ...repo, issue_number: 1, botLogin: BOT, body: `${AGENT_MARKER}\n@claude go` };
    expect(await triggerAgentOnce(fake.octokit, args)).toBe(true);
    expect(await triggerAgentOnce(fake.octokit, args)).toBe(false);
    expect(fake.state.comments[1]).toHaveLength(1);
  });
});

describe("closeStreakIssue", () => {
  it("comments, then closes", async () => {
    const fake = fakeGitHub({ labels: new Set([LABEL]) });
    const number = await openStreakIssue(fake.octokit, { ...repo, title: "t", body: marker });
    await closeStreakIssue(fake.octokit, { ...repo, issue_number: number, comment: "fixed" });
    expect(fake.state.comments[number]).toEqual([{ user: { login: BOT }, body: "fixed" }]);
    expect(fake.state.issues[0]!.state).toBe("closed");
  });
});
