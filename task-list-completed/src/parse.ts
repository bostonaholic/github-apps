// Pure functions for extracting GFM task list items and control markers
// from markdown. No I/O.

export interface Task {
  text: string;
  checked: boolean;
}

// A task line: optional indent, a list marker (-, *, +, 1., 1)), then [ ]/[x]
// followed by at least one space and non-empty text.
const TASK_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+)$/;

const FENCE_RE = /^\s*(`{3,}|~{3,})/;

// Blank out fenced code blocks so checkboxes inside them are not counted.
// Lines are preserved (as empty strings) to keep the structure intact.
export function stripCodeFences(markdown: string): string {
  let inFence = false;
  let fenceChar = "";
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(FENCE_RE);
      if (match) {
        const char = match[1][0];
        if (!inFence) {
          inFence = true;
          fenceChar = char;
        } else if (char === fenceChar) {
          inFence = false;
        }
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = [];
  for (const line of stripCodeFences(markdown).split("\n")) {
    const match = line.match(TASK_RE);
    if (!match) continue;
    const text = match[2].trim();
    if (!text) continue;
    tasks.push({ text, checked: match[1] !== " " });
  }
  return tasks;
}

// Control markers. Matching is whitespace- and case-insensitive so
// hand-typed variants like <!--TASK-LIST:IGNORE--> still work.
const marker = (name: string) =>
  new RegExp(`<!--\\s*task-list:\\s*${name}\\s*-->`, "i");

const IGNORE_RE = marker("ignore");
const DISABLE_RE = marker("disable");
const STICKY_RE = marker("sticky-comment");

// This source's checkboxes are notes, not gates.
export function hasIgnoreMarker(body: string): boolean {
  return IGNORE_RE.test(body);
}

// In the PR description: turn the gate off for the whole PR.
export function hasDisableMarker(body: string): boolean {
  return DISABLE_RE.test(body);
}

// Identifies the bot's own status comment.
export function isStickyComment(body: string): boolean {
  return STICKY_RE.test(body);
}
