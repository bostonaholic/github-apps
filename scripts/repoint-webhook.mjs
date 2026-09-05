// Read or repoint a GitHub App registration's webhook URL, authenticated
// as the app (JWT signed with its private key). Works for any app in this
// repo — point --env-file at the app's .env:
//
//   node --env-file=apps/<app>/.env scripts/repoint-webhook.mjs --dry-run
//   node --env-file=apps/<app>/.env scripts/repoint-webhook.mjs <new-webhook-url>
//
// --dry-run (or no argument) prints the current config and exits. The
// webhook secret is never changed — only the URL.
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

const headers = {
  authorization: `Bearer ${jwt}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
};

const current = await fetch("https://api.github.com/app/hook/config", {
  headers,
});
console.log("current config:", await current.json());

const arg = process.argv[2];
if (!arg || arg === "--dry-run") process.exit(0);

const res = await fetch("https://api.github.com/app/hook/config", {
  method: "PATCH",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({ url: arg }),
});
console.log("patch status:", res.status);
console.log("new config:", await res.json());
