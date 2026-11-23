// Pure: repo config defaults and normalization. The config file name is
// declared in index.ts.
export interface AppConfig {
  enabled: boolean;
  // Names of the check runs (or commit-status contexts) that are this
  // repo's CI. Only these decide red and green. Empty: the app does
  // nothing.
  ci_checks: string[];
  // Who the trigger comment mentions, with its leading "@".
  agent_handle: string;
  // How many lines of a failing step's log the issue quotes.
  log_lines: number;
}

export const DEFAULT_AGENT_HANDLE = "@claude";
export const DEFAULT_LOG_LINES = 50;
// Keeps a streak issue under GitHub's 65,536-character body limit for a
// few failing checks.
export const MAX_LOG_LINES = 200;

// A user, a bot, or an org team: `claude`, `@claude`, `@org/team`.
const HANDLE = /^@?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9._-]+)?$/;

// Clamp a user-supplied config to safe values. A malformed value falls
// back to its default, except `ci_checks`, which falls back to none, so a
// typo never makes the app act on checks the repo did not name.
export function normalizeConfig(raw: Record<string, unknown> | null): AppConfig {
  const config = raw ?? {};
  return {
    enabled: config.enabled !== false,
    ci_checks: stringList(config.ci_checks),
    agent_handle: agentHandle(config.agent_handle),
    log_lines: logLines(config.log_lines),
  };
}

// A bare string counts as a one-entry list: `ci_checks: test`.
function stringList(value: unknown): string[] {
  const entries = typeof value === "string" ? [value] : value;
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (entry): entry is string => typeof entry === "string" && entry !== "",
  );
}

function agentHandle(value: unknown): string {
  if (typeof value !== "string" || !HANDLE.test(value)) return DEFAULT_AGENT_HANDLE;
  return value.startsWith("@") ? value : `@${value}`;
}

function logLines(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return DEFAULT_LOG_LINES;
  }
  return Math.min(value, MAX_LOG_LINES);
}
