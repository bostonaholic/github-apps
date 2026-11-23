// Git, gh, and filesystem access shared by the release scripts. Commands run
// through execFileSync with argument arrays — no shell, no interpolation.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

// Runs a command and returns trimmed stdout; throws on non-zero exit.
export const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

// Runs a command and reports only whether it exited 0.
export function succeeds(cmd, args, opts = {}) {
  try {
    execFileSync(cmd, args, { stdio: "ignore", ...opts });
    return true;
  } catch {
    return false;
  }
}

export const repoRoot = () => run("git", ["rev-parse", "--show-toplevel"]);

// Paths for one app; exits if the app directory is not a package.
export function appPaths(app) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(app ?? "")) {
    fail(`usage: <app> must be a directory name under apps/ (got ${JSON.stringify(app)})`);
  }
  const root = repoRoot();
  const dir = join(root, "apps", app);
  const pkg = join(dir, "package.json");
  const changelog = join(dir, "CHANGELOG.md");
  if (!existsSync(pkg)) fail(`apps/${app}/package.json not found`);
  if (!existsSync(changelog)) fail(`apps/${app}/CHANGELOG.md not found`);
  return { root, dir, pkg, changelog, rel: `apps/${app}` };
}

export const readVersion = (pkgPath) => JSON.parse(readFileSync(pkgPath, "utf8")).version;

// Newest first, per AGENTS.md "Listing an app's releases".
export const appTags = (root, app) =>
  run("git", ["tag", "--list", `${app}-v*`, "--sort=-version:refname"], { cwd: root })
    .split("\n")
    .filter(Boolean);

export const showAt = (root, ref, path) => run("git", ["show", `${ref}:${path}`], { cwd: root });

export const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
