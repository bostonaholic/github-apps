// Pure: the PR comment command that grades the head commit again, with
// the default model or one the commenter names.
//
//   /merge-warden grade          the default model
//   /merge-warden grade opus     an alias
//   /merge-warden grade claude-opus-5-5
//
// The command must be a line of its own, so quoting it inside prose does
// not run it.

export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
  fable: "claude-fable-5-2",
};

// Full model IDs are passed to the API as given. The character set keeps
// the ID safe to place in the comment marker and the comment text.
const MODEL_ID = /^claude-[a-z0-9.-]+$/;

const COMMAND = /^\/merge-warden\s+grade(?:\s+(\S+))?$/i;

export type Command =
  // model null: the default model.
  | { kind: "grade"; model: string | null }
  | { kind: "unknown-model" };

export function parseCommand(body: string): Command | null {
  for (const line of body.split(/\r?\n/)) {
    const match = COMMAND.exec(line.trim());
    if (!match) continue;
    const arg = match[1]?.toLowerCase();
    if (arg === undefined) return { kind: "grade", model: null };
    const model = MODEL_ALIASES[arg] ?? (MODEL_ID.test(arg) ? arg : null);
    return model === null ? { kind: "unknown-model" } : { kind: "grade", model };
  }
  return null;
}

// The legacy `permission` field GitHub returns for a collaborator:
// "admin", "write" (also maintain), "read" (also triage), or "none".
// Grading again can change the verdict, so it takes write access.
export function canGrade(permission: string): boolean {
  return permission === "admin" || permission === "write";
}

export const UNKNOWN_MODEL_REPLY = `merge-warden: unknown model. Use ${Object.keys(
  MODEL_ALIASES,
).join(", ")}, or a full \`claude-*\` model ID.`;
