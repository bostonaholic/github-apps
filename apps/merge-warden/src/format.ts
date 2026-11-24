// Pure: the check run's title and summary, and the sticky pull request
// comment that carries the grade. The table is built from validated enums
// only. Free text from the model and from file paths is
// flattened by plainText before it is rendered.

import { commentFooter } from "./build.js";
import type { Grade } from "./grade.js";
import type { Verdict } from "./policy.js";
import type { Door, Level } from "./signals.js";

export const CHECK_NAME = "merge-warden";
// Marks the app's grade comment for one model, so a grade with that model
// edits it and a grade with another model adds its own.
export function commentMarker(model: string): string {
  return `<!-- merge-warden: grade model=${model} -->`;
}
// The marker before comments were per model. Such a comment belongs to
// the default model.
export const LEGACY_COMMENT_MARKER = "<!-- merge-warden: grade -->";

// A grade a person asked for on an out-of-scope pull request. The app
// reports it and never approves, arms, or merges.
export interface GradeOnly {
  requestedBy: string;
  // Why the pull request is out of scope.
  scope: string;
}

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

export function checkOutput(
  grade: Grade,
  verdict: Verdict,
  model: string,
  gradeOnly: GradeOnly | null = null,
): CheckOutput {
  const title = gradeOnly
    ? `Grade only: ${plainText(verdict.reason, 100)}`
    : verdict.eligible
      ? "Eligible for auto-merge"
      : `Needs a person: ${plainText(verdict.reason, 100)}`;
  return {
    title,
    summary: [
      `**Why:** ${plainText(verdict.reason, 200)}`,
      "",
      `Graded with ${model}. The grade and findings are in the merge-warden comment on the pull request.`,
      ...(gradeOnly ? ["", gradeOnlyNote(gradeOnly)] : []),
    ].join("\n"),
  };
}

function gradeOnlyNote({ requestedBy, scope }: GradeOnly): string {
  return `**Grade only:** graded because ${plainText(requestedBy, 100)} asked. This pull request is out of scope (${plainText(scope, 100)}), so merge-warden does not approve or merge it, whatever the grade.`;
}

// `model` is the model asked to grade; the footer names it only when it
// returned an assessment.
export function commentBody(
  grade: Grade,
  verdict: Verdict,
  sha: string,
  model: string,
  gradeOnly: GradeOnly | null = null,
): string {
  const heading = gradeOnly
    ? "### 📝 merge-warden: grade only"
    : verdict.eligible
      ? "### ✅ merge-warden: eligible for auto-merge"
      : "### ⚠️ merge-warden: needs a person";
  return [
    commentMarker(model),
    heading,
    "",
    ...(gradeOnly ? [gradeOnlyNote(gradeOnly), ""] : []),
    ...report(grade, verdict, gradeOnly !== null),
    "",
    `<sub>Graded commit ${sha.slice(0, 7)} with ${model}. A new commit is graded again with the default model. Comment <code>/merge-warden grade [model]</code> to grade again with this one or another.</sub>`,
    "",
    "---",
    "",
    commentFooter(grade.assessment ? model : null),
  ].join("\n");
}

function report(grade: Grade, verdict: Verdict, gradeOnly: boolean): string[] {
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
      gradeOnly ? "👤 Person" : verdict.eligible ? "🟢 Merge" : "🔴 Review",
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
