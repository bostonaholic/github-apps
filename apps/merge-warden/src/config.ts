// Pure: repo config defaults and normalization, plus the two labels the
// app reads. The config file name is declared in index.ts.

export type MergeMethod = "squash" | "merge" | "rebase";

export interface WardenConfig {
  enabled: boolean;
  // Lowercased logins whose PRs may be auto-merged. Nobody else's are.
  authors: string[];
  merge_method: MergeMethod;
  // Names of the check runs (or commit-status contexts) that are this
  // repo's CI. All must succeed before the app merges directly. Empty:
  // the app never merges directly.
  ci_checks: string[];
}

// Forces the one-way-door verdict. No label reverses it.
export const ONE_WAY_DOOR_LABEL = "one-way-door";
// Per-PR opt-out from merging. The PR is still graded.
export const NO_AUTO_MERGE_LABEL = "no-auto-merge";

const MERGE_METHODS: readonly string[] = ["squash", "merge", "rebase"];

// Clamp a user-supplied config to safe values. A missing `authors` means
// the repo owner; a malformed one means nobody, so a typo never widens who
// can be merged.
export function normalizeConfig(
  raw: Record<string, unknown> | null,
  repoOwner: string,
): WardenConfig {
  const config = raw ?? {};
  const authors =
    config.authors === undefined || config.authors === null
      ? [repoOwner]
      : stringList(config.authors);
  return {
    enabled: config.enabled !== false,
    authors: authors.map((login) => login.toLowerCase()),
    merge_method: isMergeMethod(config.merge_method) ? config.merge_method : "squash",
    ci_checks: stringList(config.ci_checks),
  };
}

// A bare string counts as a one-entry list: `authors: octocat`.
function stringList(value: unknown): string[] {
  const entries = typeof value === "string" ? [value] : value;
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (entry): entry is string => typeof entry === "string" && entry !== "",
  );
}

function isMergeMethod(value: unknown): value is MergeMethod {
  return typeof value === "string" && MERGE_METHODS.includes(value);
}
