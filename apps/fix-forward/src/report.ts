// Pure: everything the app writes on GitHub — the streak issue (title,
// body, and the hidden marker that is the app's only stored state), the
// trigger comment, the closing comments — and the log excerpt they quote.

export const LABEL = "main-broken";
// GitHub rejects an issue body over 65,536 characters.
export const MAX_BODY = 65_536;
// Marks the one trigger comment, so it is posted once per issue.
export const AGENT_MARKER = "<!-- fix-forward:agent -->";
// Range lines listed before the rest are summarized.
const MAX_RANGE_LINES = 20;

// The streak an issue belongs to (`base`, the last green commit before it,
// or null when none was found) and the red commits already reported in it.
export interface Marker {
  base: string | null;
  reported: string[];
}

export interface JobLog {
  job: string;
  step: string | null;
  lines: string[];
}

export interface FailureReport {
  name: string;
  url: string | null;
  log: JobLog | null;
  // Why there is no log, when there is none.
  note: string | null;
}

export interface CommitReport {
  sha: string;
  failures: FailureReport[];
}

export interface Culprit {
  sha: string;
  pr: { number: number; title: string; url: string };
}

export interface StreakFacts {
  repoUrl: string;
  branch: string;
  base: string | null;
  range: string[];
  culprit: Culprit | null;
}

const MARKER = /<!-- fix-forward base=([0-9A-Za-z]+) reported=([0-9A-Za-z,]*) -->/;

export function formatMarker({ base, reported }: Marker): string {
  return `<!-- fix-forward base=${base ?? "none"} reported=${reported.join(",")} -->`;
}

export function parseMarker(body: string | null | undefined): Marker | null {
  const match = MARKER.exec(body ?? "");
  if (!match) return null;
  return {
    base: match[1] === "none" ? null : match[1]!,
    reported: match[2] === "" ? [] : match[2]!.split(","),
  };
}

export function issueTitle(branch: string, culprit: Culprit | null): string {
  const cause = culprit ? `after #${culprit.pr.number}` : "culprit unknown";
  return `${branch} is red: ${cause}`;
}

export function issueBody(facts: StreakFacts, commits: readonly CommitReport[]): string {
  const marker = formatMarker({ base: facts.base, reported: commits.map((c) => c.sha) });
  const head = [marker, summary(facts), task(), "## Failures", ""].join("\n\n");
  return fitted(head, facts.repoUrl, commits);
}

// The body with sections for newly red commits added and the marker
// updated to list them as reported.
export function appendToBody(
  body: string,
  repoUrl: string,
  marker: Marker,
  commits: readonly CommitReport[],
): string {
  const next = formatMarker({
    base: marker.base,
    reported: [...marker.reported, ...commits.map((c) => c.sha)],
  });
  return fitted(`${body.replace(MARKER, next).trimEnd()}\n\n`, repoUrl, commits);
}

export function agentComment(handle: string): string {
  return [
    AGENT_MARKER,
    `${handle} the default branch is red. Follow the task in this issue: find the root cause of the failures it lists, fix it forward on a new branch, and open a pull request that closes this issue. No revert; no skipped or deleted tests.`,
  ].join("\n");
}

export function fixedComment(repoUrl: string, sha: string): string {
  return `CI is green again at ${commitLink(repoUrl, sha)}, which fixed this streak.`;
}

export function supersededComment(repoUrl: string, greenSha: string): string {
  return `CI was green at ${commitLink(repoUrl, greenSha)} after this streak, so it is over. A new streak gets its own issue.`;
}

export interface StepTimes {
  started_at?: string | null;
  completed_at?: string | null;
}

const TIMESTAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?/;

// The last `count` lines of one step's part of a job log. Actions prefixes
// every log line with a timestamp; a step owns the lines stamped between
// its start and its completion (whole seconds, so the end is widened by
// one). Lines with no stamp belong with the line before. When the step's
// times match no line, the job log's tail stands in.
export function stepLogTail(log: string, step: StepTimes | null, count: number): string[] {
  const raw = log.split(/\r?\n/);
  if (raw[raw.length - 1] === "") raw.pop();
  let time = Number.NaN;
  const lines = raw.map((line) => {
    const match = TIMESTAMP.exec(line);
    if (!match) return { time, text: line };
    time = Date.parse(match[1]!.replace(/(\.\d{3})\d*Z$/, "$1Z"));
    return { time, text: line.slice(match[0].length) };
  });
  const start = Date.parse(step?.started_at ?? "");
  const end = Date.parse(step?.completed_at ?? "") + 1000;
  const inStep = lines.filter((l) => l.time >= start && l.time < end);
  return (inStep.length > 0 ? inStep : lines).slice(-count).map((l) => l.text);
}

// A fence longer than any backtick run inside, so a log cannot close it.
export function fence(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}text\n${text}\n${ticks}`;
}

// Untrusted text (a PR title, a job name) as inline code: no markdown, no
// mentions, one line.
function code(text: string): string {
  return `\`${text.replace(/[`\r\n]+/g, " ").trim()}\``;
}

function commitLink(repoUrl: string, sha: string): string {
  return `[\`${sha.slice(0, 7)}\`](${repoUrl}/commit/${sha})`;
}

function summary({ repoUrl, branch, base, range, culprit }: StreakFacts): string {
  const lines = [`CI on \`${branch}\` is red.`, ""];
  if (culprit) {
    lines.push(
      `**Culprit:** #${culprit.pr.number} ${code(culprit.pr.title)}, merge commit ${commitLink(repoUrl, culprit.sha)} ([diff](${culprit.pr.url}/files)).`,
    );
  } else {
    lines.push("**Culprit:** unknown.");
  }
  lines.push("");
  const head = range[range.length - 1];
  if (base && head) {
    lines.push(
      `Commits since the last green commit ${commitLink(repoUrl, base)} ([compare](${repoUrl}/compare/${base}...${head})):`,
    );
  } else {
    lines.push("No green commit found in the history walked. Commits walked:");
  }
  lines.push("");
  for (const sha of range.slice(-MAX_RANGE_LINES)) lines.push(`- ${commitLink(repoUrl, sha)}`);
  if (range.length > MAX_RANGE_LINES) {
    lines.push(`- and ${range.length - MAX_RANGE_LINES} older`);
  }
  return lines.join("\n");
}

function task(): string {
  return [
    "## Task",
    "",
    "Find the root cause of the failures below and fix it forward: commit the fix to a new branch and open a pull request that closes this issue. Do not revert the culprit, and do not skip, delete, or weaken tests to make CI pass.",
  ].join("\n");
}

// Sections with logs when they fit under GitHub's limit, else without.
function fitted(head: string, repoUrl: string, commits: readonly CommitReport[]): string {
  const full = head + commits.map((c) => commitSection(repoUrl, c, true)).join("\n\n");
  if (full.length <= MAX_BODY) return full;
  return head + commits.map((c) => commitSection(repoUrl, c, false)).join("\n\n");
}

function commitSection(repoUrl: string, commit: CommitReport, withLogs: boolean): string {
  const parts = [`### ${commitLink(repoUrl, commit.sha)}`];
  for (const failure of commit.failures) {
    const link = failure.url ? ` ([details](${failure.url}))` : "";
    parts.push(`#### ${code(failure.name)}${link}`);
    if (failure.log) {
      const step = failure.log.step ? `, step ${code(failure.log.step)}` : ", failing step unknown";
      parts.push(`Job ${code(failure.log.job)}${step}.`);
      if (withLogs) parts.push(fence(failure.log.lines.join("\n")));
      else parts.push("Log omitted: the issue is at GitHub's size limit.");
    }
    if (failure.note) parts.push(failure.note);
  }
  return parts.join("\n\n");
}
