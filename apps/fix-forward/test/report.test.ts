import { describe, expect, it } from "vitest";
import {
  AGENT_MARKER,
  MAX_BODY,
  agentComment,
  appendToBody,
  fence,
  fixedComment,
  formatMarker,
  issueBody,
  issueTitle,
  parseMarker,
  stepLogTail,
  type CommitReport,
  type StreakFacts,
} from "../src/report.js";

const URL = "https://github.com/o/r";
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

const facts: StreakFacts = {
  repoUrl: URL,
  branch: "main",
  base: A,
  range: [B, C],
  culprit: { sha: B, pr: { number: 12, title: "Break `things` @claude", url: `${URL}/pull/12` } },
};

const commit = (sha: string, lines = ["FAIL x"]): CommitReport => ({
  sha,
  failures: [
    { name: "test", url: "https://ci/1", log: { job: "unit", step: "Run tests", lines }, note: null },
    { name: "lint", url: null, log: null, note: "Not a GitHub Actions check, so no log." },
  ],
});

describe("marker", () => {
  it("round-trips through the body", () => {
    const marker = { base: A, reported: [B, C] };
    expect(parseMarker(`x\n${formatMarker(marker)}\ny`)).toEqual(marker);
    expect(parseMarker(formatMarker({ base: null, reported: [] }))).toEqual({ base: null, reported: [] });
  });

  it("is absent from a body without one", () => {
    expect(parseMarker("hello")).toBeNull();
    expect(parseMarker(null)).toBeNull();
  });
});

describe("issueTitle", () => {
  it("names the culprit PR or says unknown", () => {
    expect(issueTitle("main", facts.culprit)).toBe("main is red: after #12");
    expect(issueTitle("main", null)).toBe("main is red: culprit unknown");
  });
});

describe("issueBody", () => {
  const body = issueBody(facts, [commit(B)]);

  it("names the culprit PR, its merge commit, and a diff link", () => {
    expect(body).toContain("**Culprit:** #12 `Break  things  @claude`");
    expect(body).toContain(`[\`bbbbbbb\`](${URL}/commit/${B})`);
    expect(body).toContain(`([diff](${URL}/pull/12/files))`);
  });

  it("links the range since the last green commit", () => {
    expect(body).toContain(`([compare](${URL}/compare/${A}...${C}))`);
    expect(body).toContain(`- [\`ccccccc\`](${URL}/commit/${C})`);
  });

  it("carries each failing check's job, step, and log, and the no-revert task", () => {
    expect(body).toContain("#### `test` ([details](https://ci/1))");
    expect(body).toContain("Job `unit`, step `Run tests`.");
    expect(body).toContain("```text\nFAIL x\n```");
    expect(body).toContain("Not a GitHub Actions check, so no log.");
    expect(body).toMatch(/Do not revert the culprit, and do not skip, delete, or weaken tests/);
  });

  it("records the streak base and the reported commits in the marker", () => {
    expect(parseMarker(body)).toEqual({ base: A, reported: [B] });
  });

  it("marks the culprit unknown and lists the walked commits when there is no base", () => {
    const unknown = issueBody({ ...facts, base: null, culprit: null }, [commit(B)]);
    expect(unknown).toContain("**Culprit:** unknown.");
    expect(unknown).toContain("No green commit found in the history walked.");
    expect(unknown).toContain(`- [\`bbbbbbb\`](${URL}/commit/${B})`);
  });

  it("drops logs rather than exceed GitHub's body limit", () => {
    const huge = issueBody(facts, [commit(B, ["x".repeat(MAX_BODY)])]);
    expect(huge.length).toBeLessThanOrEqual(MAX_BODY);
    expect(huge).toContain("Log omitted");
  });
});

describe("appendToBody", () => {
  it("adds sections for new red commits and records them in the marker", () => {
    const body = issueBody(facts, [commit(B)]);
    const next = appendToBody(body, URL, parseMarker(body)!, [commit(C)]);
    expect(next).toContain(`### [\`bbbbbbb\`](${URL}/commit/${B})`);
    expect(next).toContain(`### [\`ccccccc\`](${URL}/commit/${C})`);
    expect(parseMarker(next)).toEqual({ base: A, reported: [B, C] });
  });
});

describe("comments", () => {
  it("mentions the agent once, with the marker", () => {
    const body = agentComment("@claude");
    expect(body).toContain(AGENT_MARKER);
    expect(body.match(/@claude/g)).toHaveLength(1);
    expect(body).toMatch(/No revert/);
  });

  it("names the fixing commit", () => {
    expect(fixedComment(URL, C)).toContain(`[\`ccccccc\`](${URL}/commit/${C})`);
  });
});

describe("stepLogTail", () => {
  const log = [
    "2026-11-22T10:00:00.1234567Z setup",
    "2026-11-22T10:00:02.0000000Z step line 1",
    "continued",
    "2026-11-22T10:00:03.9000000Z step line 2",
    "2026-11-22T10:00:05.0000000Z cleanup",
    "",
  ].join("\n");
  const step = { started_at: "2026-11-22T10:00:02Z", completed_at: "2026-11-22T10:00:03Z" };

  it("keeps the step's lines, without timestamps, last N", () => {
    expect(stepLogTail(log, step, 50)).toEqual(["step line 1", "continued", "step line 2"]);
    expect(stepLogTail(log, step, 2)).toEqual(["continued", "step line 2"]);
  });

  it("falls back to the job log's tail when the step matches nothing", () => {
    expect(stepLogTail(log, null, 2)).toEqual(["step line 2", "cleanup"]);
  });
});

describe("fence", () => {
  it("outlasts any backtick run in the log", () => {
    expect(fence("a ```` b")).toBe("`````text\na ```` b\n`````");
  });
});
