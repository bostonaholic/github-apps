// Pure: repo config defaults and normalization. The config file name is
// declared in index.ts.
export interface AppConfig {
  enabled: boolean;
}

const DEFAULTS: AppConfig = { enabled: true };

export function normalizeConfig(
  raw: Record<string, unknown> | null,
): AppConfig {
  if (raw === null) return DEFAULTS;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
  };
}
