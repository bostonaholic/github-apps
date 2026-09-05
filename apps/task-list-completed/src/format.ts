// Pure functions that build the commit status and the sticky comment body.

export const STATUS_CONTEXT = "task-list-completed";
export const STICKY_MARKER = "<!-- task-list: sticky-comment -->";
export const DISABLE_LABEL = "task-list: disabled";

export type SourceKind = "description" | "comment" | "review" | "review comment";

export interface OutstandingItem {
  text: string;
  url: string;
  source: SourceKind;
}

export interface CommitStatus {
  state: "success" | "failure";
  description: string;
}

const tasks = (n: number) => (n === 1 ? "task" : "tasks");

export function buildStatus(input: {
  disabled: boolean;
  total: number;
  outstanding: number;
}): CommitStatus {
  if (input.disabled) {
    return { state: "success", description: "Task list checks are disabled" };
  }
  if (input.total === 0) {
    return { state: "success", description: "No tasks found" };
  }
  if (input.outstanding > 0) {
    return {
      state: "failure",
      description: `${input.outstanding} of ${input.total} ${tasks(input.total)} remaining`,
    };
  }
  return {
    state: "success",
    description: `All ${input.total} ${tasks(input.total)} complete`,
  };
}

// Flatten markdown that would break inside a link label: nested links and
// images become their text, whitespace collapses, long text is truncated.
export function inlineText(text: string, max = 100): string {
  let flat = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length > max) {
    flat = flat.slice(0, max - 1).trimEnd() + "…";
  }
  return flat.replace(/\\/g, "\\\\").replace(/([[\]])/g, "\\$1");
}

export function buildStickyBody(
  outstanding: OutstandingItem[],
  total: number,
): string {
  if (outstanding.length === 0) {
    return `${STICKY_MARKER}
### ✅ Task list: all ${total} ${tasks(total)} complete

Nothing outstanding — the \`${STATUS_CONTEXT}\` status is green.`;
  }

  const items = outstanding
    .map((item) => `- [${inlineText(item.text)}](${item.url}) — *${item.source}*`)
    .join("\n");

  return `${STICKY_MARKER}
### ⏳ Task list: ${outstanding.length} of ${total} ${tasks(total)} remaining

These unchecked tasks block merging. Check each box where it was written and
this comment and the \`${STATUS_CONTEXT}\` status will update automatically.

${items}

<sub>Checkboxes that are just notes? Add \`<!-- task-list: ignore -->\` to that
comment, or disable the gate for this PR with \`<!-- task-list: disable -->\`
in the description or the \`${DISABLE_LABEL}\` label.</sub>`;
}
