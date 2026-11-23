// Pure: the check run's title and summary, and the sticky pull request
// comment that carries the grade. The table is built from validated enums
// only. Free text from the model and from file paths is
// flattened by plainText before it is rendered.

import { BUILD_FOOTER } from "./build.js";
import type { Grade } from "./grade.js";
import type { Verdict } from "./policy.js";
import type { Door, Level } from "./signals.js";

export const CHECK_NAME = "merge-warden";
// Marks the app's one grade comment on a pull request, so each grade
// edits it instead of adding another.
export const COMMENT_MARKER = "<!-- merge-warden: grade -->";

export interface CheckOutput {
  title: string;
  summary: string;
}

// A traffic light per level, so a grade reads at a glance in the table
// and in the findings list.
const LEVEL_LABEL: Record<Level, string> = {
  low: "🟢 Low",
  medium: "🟡 Medium",
  high: "🔴 High",
};

// The door in the word most people use for it: can a revert undo this?
// One word per cell; the Why line and the reasons list carry the detail.
const DOOR_LABEL: Record<Door, string> = {
  "two-way": "🔄 Reversible",
  "one-way": "⛔ Irreversible",
};

const MAX_LISTED = 10;

// Flatten untrusted text to one line of plain prose: links and images
// become their label, bare URLs and HTML/table syntax are removed,
// whitespace collapses (so no headings, lists, or tables can start),
// and long text is truncated.
export function plainText(text: string, max = 300): string {
  let flat = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, "(link removed)")
    .replace(/[<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length > max) {
    flat = flat.slice(0, max - 1).trimEnd() + "…";
  }
  return flat;
}

export function checkOutput(grade: Grade, verdict: Verdict): CheckOutput {
  return {
    title: verdict.eligible
      ? "Eligible for auto-merge"
      : `Needs a person: ${plainText(verdict.reason, 100)}`,
    summary: [
      `**Why:** ${plainText(verdict.reason, 200)}`,
      "",
      "The grade and findings are in the merge-warden comment on the pull request.",
    ].join("\n"),
  };
}

export function commentBody(grade: Grade, verdict: Verdict, sha: string): string {
  const heading = verdict.eligible
    ? "### ✅ merge-warden: eligible for auto-merge"
    : "### ⚠️ merge-warden: needs a person";
  return [
    COMMENT_MARKER,
    heading,
    "",
    ...report(grade, verdict),
    "",
    `<sub>Graded commit ${sha.slice(0, 7)}. A new commit is graded again and this comment updates.</sub>`,
    "",
    BUILD_FOOTER,
  ].join("\n");
}

function report(grade: Grade, verdict: Verdict): string[] {
  const assessment = grade.assessment;
  const axis = (level: Level | undefined) => (level ? LEVEL_LABEL[level] : "—");
  const reason = plainText(verdict.reason, 200);

  const lines = [
    "| Risk | Customer | Data/security | Recovery | Door | Decision | Confidence |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    `| ${[
      LEVEL_LABEL[grade.risk],
      axis(assessment?.customer),
      axis(assessment?.data_security),
      axis(assessment?.recovery),
      DOOR_LABEL[grade.door],
      verdict.eligible ? "🟢 Merge" : "🔴 Review",
      assessment ? `${grade.confidence}%` : "—",
    ].join(" | ")} |`,
    "",
    "Risk is the highest of the three axes and any finding.",
    "",
    `**Why:** ${reason}`,
  ];

  // The verdict names one reason. A one-way door outranks "not graded",
  // so say separately why the axes and the confidence are blank.
  if (grade.ungraded !== null) {
    lines.push("", `**Not graded:** ${plainText(grade.ungraded, 200)}`);
  }

  if (grade.doorReasons.length > 0) {
    lines.push("", "**One-way door because:**", ...bullets(grade.doorReasons));
  }
  if (assessment) {
    lines.push("", `**Summary:** ${plainText(assessment.summary, 600)}`, "", "**Findings**");
    if (assessment.findings.length === 0) {
      lines.push("", "Nothing to fix.");
    } else {
      lines.push(
        ...bullets(
          assessment.findings.map(
            (finding) => `${LEVEL_LABEL[finding.severity]}: ${finding.text}`,
          ),
        ),
      );
    }
  }

  return lines;
}

function bullets(items: string[]): string[] {
  const shown = items.slice(0, MAX_LISTED).map((item) => `- ${plainText(item)}`);
  const hidden = items.length - shown.length;
  return ["", ...shown, ...(hidden > 0 ? [`- and ${hidden} more`] : [])];
}
