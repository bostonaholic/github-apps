// The running build's identity, shown as a footer on the app's PR comment
// so a reader can tell which release and commit wrote it.

import { readFileSync } from "node:fs";

// Pure: "<sub>task-list-completed v1.2.3 · abc1234</sub>", without the SHA when none is known.
export function buildFooter(version: string, sha: string | undefined): string {
  const id = sha ? `v${version} · ${sha.slice(0, 7)}` : `v${version}`;
  return `<sub>task-list-completed ${id}</sub>`;
}

// package.json sits one level above both src/ (tests) and lib/ (build).
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

// Vercel sets VERCEL_GIT_COMMIT_SHA on deployed functions; local runs have none.
export const BUILD_FOOTER = buildFooter(version, process.env.VERCEL_GIT_COMMIT_SHA);
