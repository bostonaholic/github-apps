// List or extend a GitHub App installation's repo selection. Reads
// authenticate as the app (JWT signed with its private key); the add
// write goes through the user-level classic PAT — the only token type
// GitHub accepts on PUT /user/installations/{id}/repositories/{repo_id}.
// Works for any app in this repo — point --env-file at the app's .env:
//
//   node --env-file=apps/<app>/.env scripts/installation-repos.mjs                 # list
//   node --env-file=apps/<app>/.env scripts/installation-repos.mjs --add <owner/repo>
//
// List output: the installation id on the first line, then one selected
// repo (owner/name) per line. Prints NOT INSTALLED and exits 1 when the
// app has no installations.
import { createSign } from "node:crypto";

const appId = process.env.APP_ID;
let pem = process.env.PRIVATE_KEY ?? "";
if (pem.includes("\\n")) pem = pem.replaceAll("\\n", "\n");
if (!appId || !pem) {
  console.error(
    "APP_ID / PRIVATE_KEY missing — run with --env-file=apps/<app>/.env",
  );
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned =
  b64({ alg: "RS256", typ: "JWT" }) +
  "." +
  b64({ iat: now - 60, exp: now + 540, iss: appId });
const sig = createSign("RSA-SHA256").update(unsigned).sign(pem, "base64url");
const jwt = unsigned + "." + sig;

const api = async (path, { token = jwt, method = "GET" } = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (res.status === 204) return { status: res.status };
  if (!res.ok) {
    console.error(`${method} ${path} -> ${res.status}`);
    process.exit(1);
  }
  return res.json();
};

const list = async () => {
  const installs = await api("/app/installations");
  if (!installs.length) {
    console.log("NOT INSTALLED");
    process.exit(1);
  }
  const id = installs[0].id;
  const { token } = await api(`/app/installations/${id}/access_tokens`, {
    method: "POST",
  });
  const body = await api("/installation/repositories?per_page=100", { token });
  return { id, repos: body.repositories.map((r) => r.full_name) };
};

const print = ({ id, repos }) => {
  console.log(id);
  repos.forEach((r) => console.log(r));
};

const [flag, target] = process.argv.slice(2);
if (!flag) {
  print(await list());
  process.exit(0);
}
if (flag !== "--add" || !/^[^/\s]+\/[^/\s]+$/.test(target ?? "")) {
  console.error("usage: installation-repos.mjs [--add <owner/repo>]");
  process.exit(1);
}

const pat = process.env.GITHUB_PAT;
if (!pat) {
  console.error("GITHUB_PAT missing — the add write needs the classic PAT");
  process.exit(1);
}

const { id, repos } = await list();
if (repos.includes(target)) {
  console.log(`already selected: ${target}`);
  print({ id, repos });
  process.exit(0);
}
const repo = await api(`/repos/${target}`, { token: pat });
const { status } = await api(
  `/user/installations/${id}/repositories/${repo.id}`,
  { token: pat, method: "PUT" },
);
console.log(`add status: ${status}`);
print(await list());
