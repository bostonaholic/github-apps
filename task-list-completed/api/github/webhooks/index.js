// Vercel serverless entry point. Vercel routes POST /api/github/webhooks
// here; Probot's middleware verifies the signature and dispatches to the
// app. Requires the NODEJS_HELPERS=0 env var so Vercel does not consume
// the request body before signature verification (it needs the raw body).
// Imports the compiled app: vercel.json's buildCommand runs `npm run build`
// (tsc -> lib/) before functions are bundled.
import { createNodeMiddleware, createProbot } from "probot";
import app from "../../../lib/index.js";

export default await createNodeMiddleware(app, {
  probot: createProbot(),
  webhooksPath: "/api/github/webhooks",
});
