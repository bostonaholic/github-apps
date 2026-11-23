// Pure: what the changed files say before the model reads them: whether
// the diff can be sent whole, and a risk floor from its size alone. The
// model judges what the diff does; no path or file name is judged here.

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
  // Set on renames.
  previous_filename?: string;
  status: string;
  changes: number;
  // Absent for binary files, very large files, and submodule bumps.
  patch?: string;
}

export interface Signals {
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

// `expectedFiles` is the pull request's own changed-file count. A list of
// any other length is incomplete or belongs to a different commit.
export function readSignals(files: ChangedFile[], expectedFiles: number): Signals {
  const changedLines = files.reduce((sum, file) => sum + file.changes, 0);
  const large = changedLines > MEDIUM_CHANGED_LINES || files.length > MEDIUM_CHANGED_FILES;
  return {
    riskFloor: large ? "medium" : "low",
    floorReasons: large ? [`large diff: ${changedLines} lines in ${files.length} files`] : [],
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
