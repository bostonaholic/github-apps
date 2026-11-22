// Pure: deterministic risk signals read from the changed files alone.
// These set a floor that the model's assessment can raise but never
// lower, and they decide on their own whether a diff is a one-way door.

import picomatch from "picomatch";
import type { WardenConfig } from "./config.js";

export type Level = "low" | "medium" | "high";
export type Door = "one-way" | "two-way";

const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };

export function maxLevel(...levels: Level[]): Level {
  return levels.reduce<Level>(
    (highest, level) => (RANK[level] > RANK[highest] ? level : highest),
    "low",
  );
}

export function exceeds(level: Level, ceiling: Level): boolean {
  return RANK[level] > RANK[ceiling];
}

// One entry of a commit comparison's `files` list.
export interface ChangedFile {
  filename: string;
  // Set on renames. Matched too, so moving a file out of a guarded
  // directory still counts as touching it.
  previous_filename?: string;
  status: string;
  changes: number;
  // Absent for binary files, very large files, and submodule bumps.
  patch?: string;
}

export interface Signals {
  door: Door;
  // Why the door is one-way; empty for a two-way door.
  doorReasons: string[];
  riskFloor: Level;
  floorReasons: string[];
  // Why the diff cannot be sent to the model whole; null when it can.
  ungradeable: string | null;
}

// The comparison endpoint lists at most this many files. At the cap the
// list may be cut short, so the diff is treated as incomplete.
export const MAX_FILES = 300;
// Budget for the patches sent to the model. Over it, nothing is sent:
// the model never grades a partial diff.
export const MAX_DIFF_CHARS = 200_000;

const MEDIUM_CHANGED_LINES = 400;
const MEDIUM_CHANGED_FILES = 20;

// dot: match dotfiles and dot-directories. nocase: SCHEMA.SQL is schema.sql.
const GLOB_OPTIONS = { dot: true, nocase: true };

const ONE_WAY_GLOBS: readonly { category: string; globs: string[]; ignore?: string[] }[] = [
  {
    category: "data change",
    globs: ["**/migrations/**", "**/migrate/**", "**/*.sql", "**/schema.*"],
  },
  {
    category: "public contract",
    globs: ["**/openapi*.{yml,yaml,json}", "**/*.proto", "**/*.graphql"],
  },
  {
    category: "security and access",
    globs: ["**/.env*", "**/secrets/**", "**/auth/**", "**/iam/**", "**/*.tf"],
    // Committed templates hold placeholders, not secrets; a revert undoes them.
    ignore: ["**/.env.{example,sample,template,dist}"],
  },
];

// Reversible, but they change what gates a merge.
const HIGH_RISK_GLOBS = [
  ".github/workflows/**",
  ".github/merge-warden.yml",
  "**/CODEOWNERS",
];

type PathRules = Pick<WardenConfig, "one_way_door_paths" | "high_risk_paths">;

// `expectedFiles` is the pull request's own changed-file count. A list of
// any other length is incomplete or belongs to a different commit.
export function readSignals(
  files: ChangedFile[],
  rules: PathRules,
  expectedFiles: number,
): Signals {
  const oneWay = [
    ...ONE_WAY_GLOBS,
    { category: "configured one-way path", globs: rules.one_way_door_paths },
  ].map(({ category, globs, ignore }: { category: string; globs: string[]; ignore?: string[] }) => ({
    category,
    matches: picomatch(globs, { ...GLOB_OPTIONS, ignore }),
  }));
  const highRisk = picomatch(
    [...HIGH_RISK_GLOBS, ...rules.high_risk_paths],
    GLOB_OPTIONS,
  );

  const doorReasons = new Set<string>();
  const floorReasons = new Set<string>();
  let riskFloor: Level = "low";

  for (const file of files) {
    const paths = file.previous_filename
      ? [file.filename, file.previous_filename]
      : [file.filename];
    for (const path of paths) {
      for (const { category, matches } of oneWay) {
        if (matches(path)) doorReasons.add(`${category}: ${path}`);
      }
      if (highRisk(path)) {
        riskFloor = "high";
        floorReasons.add(`high-risk path: ${path}`);
      }
    }
  }

  const changedLines = files.reduce((sum, file) => sum + file.changes, 0);
  if (changedLines > MEDIUM_CHANGED_LINES || files.length > MEDIUM_CHANGED_FILES) {
    riskFloor = maxLevel(riskFloor, "medium");
    floorReasons.add(`large diff: ${changedLines} lines in ${files.length} files`);
  }

  return {
    door: doorReasons.size > 0 ? "one-way" : "two-way",
    doorReasons: [...doorReasons],
    riskFloor,
    floorReasons: [...floorReasons],
    ungradeable: whyUngradeable(files, expectedFiles),
  };
}

function whyUngradeable(files: ChangedFile[], expectedFiles: number): string | null {
  if (files.length === 0) return "no changed files";
  if (files.length >= MAX_FILES) return `${MAX_FILES} or more files changed`;
  if (files.length !== expectedFiles) {
    return `file list is incomplete (${files.length} of ${expectedFiles})`;
  }
  // Only a pure rename may lack a patch. A binary file also reports zero
  // changed lines, so the line count cannot tell the two apart; the
  // status can. An empty added file is rejected with them: fail closed.
  const opaque = files.find(
    (file) =>
      file.patch === undefined && !(file.status === "renamed" && file.changes === 0),
  );
  if (opaque) return `no text diff for ${opaque.filename}`;
  const diffChars = files.reduce((sum, file) => sum + (file.patch?.length ?? 0), 0);
  if (diffChars > MAX_DIFF_CHARS) return "diff exceeds the size budget";
  return null;
}
