// Pure: the default branch's state, read from its commits newest first.

export interface CommitEntry {
  sha: string;
  verdict: "green" | "red" | "pending";
  // For a red commit: no failed Actions run is still waiting on its one
  // flake re-run. Always true for green and pending.
  confirmed: boolean;
}

export type BranchState =
  // No commit in the walked history has settled CI.
  | { state: "unknown" }
  // The newest settled commit is green. `fixing` is the oldest green
  // commit after the newest red one walked (or the oldest walked).
  | { state: "green"; fixing: string }
  // The newest settled commit is red. `base` is the last green commit
  // before the streak (null when none was walked); `range` is every
  // commit after it, oldest first; `reds` is the confirmed red commits
  // in `range`, oldest first.
  | { state: "red"; base: string | null; range: string[]; reds: string[] };

// Whether the walk has seen enough. A red branch needs the last green
// commit before it; a green branch needs the red commit before it only
// when a streak issue must be closed with the fixing commit.
export function walkDone(entries: readonly CommitEntry[], wantFixing: boolean): boolean {
  const settled = entries.filter((e) => e.verdict !== "pending");
  if (settled.length === 0) return false;
  const head = settled[0]!.verdict;
  if (head === "green" && !wantFixing) return true;
  return settled.some((e) => e.verdict !== head);
}

export function readHistory(entries: readonly CommitEntry[]): BranchState {
  const settled = entries.filter((e) => e.verdict !== "pending");
  if (settled.length === 0) return { state: "unknown" };

  if (settled[0]!.verdict === "green") {
    const firstRed = settled.findIndex((e) => e.verdict === "red");
    const greens = firstRed === -1 ? settled : settled.slice(0, firstRed);
    return { state: "green", fixing: greens[greens.length - 1]!.sha };
  }

  const baseIndex = entries.findIndex((e) => e.verdict === "green");
  const streak = (baseIndex === -1 ? [...entries] : entries.slice(0, baseIndex)).reverse();
  return {
    state: "red",
    base: baseIndex === -1 ? null : entries[baseIndex]!.sha,
    range: streak.map((e) => e.sha),
    reds: streak.filter((e) => e.verdict === "red" && e.confirmed).map((e) => e.sha),
  };
}
