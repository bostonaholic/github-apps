import type { Context, Probot } from "probot";
import { normalizeConfig, type AppConfig } from "./config.js";

const CONFIG_FILE = "__APP_NAME__.yml";

// Reads `.github/__APP_NAME__.yml` from the target repo (Probot also
// falls back to the org-wide .github repo).
async function getConfig(context: Context): Promise<AppConfig> {
  const raw = await context.config(CONFIG_FILE);
  return normalizeConfig(raw as Record<string, unknown> | null);
}

export default (app: Probot) => {
  // TODO(scaffold): wire the events declared in app.yml, delegating to an
  // orchestration module via getConfig. Wiring only — no business logic.
  void app;
  void getConfig;
};
