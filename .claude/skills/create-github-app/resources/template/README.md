# __APP_NAME__

A GitHub App that __APP_DESCRIPTION__.

<!-- TODO(scaffold): expand the pitch — what the app does, for whom, and
the one or two behaviors that matter most. -->

<!-- TODO(scaffold): behavior sections — what the app reacts to, what it
reports or does, its configuration, and how to switch it off. -->

## Setup

### 1. Register the app

```bash
npm install
npm start
```

With no `.env` configured, Probot serves a setup page at
<http://localhost:3000> that registers the app from [`app.yml`](./app.yml)
as `__APP_NAME__-bostonaholic` and writes credentials to `.env`.
GitHub App names are globally unique across GitHub, so every app in this
repo registers with the `-bostonaholic` suffix (see the root `AGENTS.md`,
"App registration names"). Alternatively, register manually and fill in
[`.env.example`](./.env.example).

Required permissions and events (declared in `app.yml`):

<!-- TODO(scaffold): one bullet per permission with its rationale, then
the events list — mirror app.yml exactly. -->

### 2. Install it on repos

Install the app on the repositories (or the whole org) it should act on.

### 3. Deploy

See [Deploy](#deploy) below to host it, or run it locally for development.

## Deploy

The app is hosted on Vercel at
<https://__APP_NAME__.bostonaholic.dev>. Pushing to `main` deploys
automatically via Vercel's git integration; the Vercel project's Root
Directory is `apps/__APP_NAME__`, and `vercel.json`'s `ignoreCommand` skips
builds for commits that don't touch this app.

- **Entry point**: [`api/github/webhooks/index.js`](./api/github/webhooks/index.js)
  wraps the compiled app (`lib/index.js`) in Probot's `createNodeMiddleware`;
  `vercel.json`'s `buildCommand` runs `tsc` before functions are bundled.
- **Env vars** (Vercel project settings): `APP_ID`, `WEBHOOK_SECRET`,
  `PRIVATE_KEY`, and `NODEJS_HELPERS=0` (stops Vercel consuming the request
  body — signature verification needs the raw body). Never set
  `WEBHOOK_PROXY_URL` in production.
- **DNS**: `__APP_NAME__` CNAME on bostonaholic.dev (Namecheap) →
  `cname.vercel-dns.com`.
- **Health probes** (no code): `GET /` serves the static landing page
  (DNS/TLS); `GET /api/github/webhooks` returns 404 JSON from a healthy
  function — a 500 there means bad credentials in the Vercel env.
- **Monitoring**: webhook health lives in the Vercel dashboard under the
  project's **Observability** (invocations, errors, duration) and **Logs**
  tabs — Web Analytics never sees webhook POSTs. The landing page loads the
  Web Analytics snippet (`/_vercel/insights/script.js`); enable Web
  Analytics on the new Vercel project (dashboard → **Analytics**) so page
  visits start collecting — until then the script 404s harmlessly.
- The GitHub App registration's webhook URL points at
  `https://__APP_NAME__.bostonaholic.dev/api/github/webhooks`.
- **Rollback**: repoint the webhook URL back at the smee channel kept as
  `WEBHOOK_PROXY_URL` in `.env`
  (`node --env-file=.env ../../scripts/repoint-webhook.mjs <smee-url>`), run
  `npm start` locally, and redeliver anything missed from the app's Recent
  Deliveries (retained ~30 days).

## Development

```bash
npm test          # vitest unit tests
npm run typecheck # tsc --noEmit
npm run build     # tsc → lib/
npm start         # probot run ./lib/index.js (set WEBHOOK_PROXY_URL for local webhooks)
```

The production app registration's webhook URL points at the hosted
deployment, so a local `npm start` + smee receives no events. For
interactive webhook debugging, register a separate dev app
(`__APP_NAME__-dev-bostonaholic`, via the empty-`.env` setup flow) with
its own smee channel, installed only on a sandbox repo — never repoint
the production app's webhook URL at smee. Set the sandbox repo's watch
status to **Ignore** (repo page → Watch → Ignore) so sandbox churn —
PRs, comments, and any deliberately failing e2e workflow runs — sends
no notifications.

<!-- TODO(scaffold): source layout list once src/ modules are designed;
e2e instructions once e2e.sh is implemented. -->
