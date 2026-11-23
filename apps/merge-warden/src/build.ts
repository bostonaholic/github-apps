// The running build's identity, shown as a footer on the app's PR comment
// so a reader can tell which release, commit, and model wrote it.

import { readFileSync } from "node:fs";

// Pure: "<sub>merge-warden v1.2.3 · abc1234 · graded by claude-haiku-5-5</sub>",
// without the SHA when none is known and without the model when none graded.
export function buildFooter(
  version: string,
  sha: string | undefined,
  model: string | null,
): string {
  const parts = [`v${version}`];
  if (sha) parts.push(sha.slice(0, 7));
  if (model) parts.push(`graded by ${model}`);
  return `<sub>merge-warden ${parts.join(" · ")}</sub>`;
}

// package.json sits one level above both src/ (tests) and lib/ (build).
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

// Vercel sets VERCEL_GIT_COMMIT_SHA on deployed functions; local runs have none.
export function commentFooter(model: string | null): string {
  return buildFooter(version, process.env.VERCEL_GIT_COMMIT_SHA, model);
}
