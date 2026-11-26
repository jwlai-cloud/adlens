import type { FirebaseApp } from "firebase/app";
import { fetchAndActivate, getRemoteConfig, getValue } from "firebase/remote-config";

/** Defaults used until Remote Config answers (or if it isn't set up). Keep in sync with remoteconfig.template.json. */
export const DEFAULTS = {
  triage_cloud_model: "gemini-3.5-flash-lite",
  deep_check_model: "gemini-4-hydrogen",
  deep_check_fallback_model: "gemini-3.8-flash",
  deep_check_template_id: "",
  /** Google Search grounding needs a billing-enabled project; free tier returns 429. */
  deep_check_search: false,
  flag_threshold: 45,
  auto_deep_check: false,
};
export type AppConfig = typeof DEFAULTS;

export async function loadConfig(app: FirebaseApp): Promise<AppConfig> {
  const rc = getRemoteConfig(app);
  rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 0 : 3_600_000;
  rc.defaultConfig = DEFAULTS;
  try {
    // Don't block the first check on the network for more than 3 s.
    await Promise.race([fetchAndActivate(rc), new Promise((r) => setTimeout(r, 3000))]);
  } catch (e) {
    console.warn("Remote Config unavailable, using defaults", e);
  }
  return {
    triage_cloud_model: getValue(rc, "triage_cloud_model").asString(),
    deep_check_model: getValue(rc, "deep_check_model").asString(),
    deep_check_fallback_model: getValue(rc, "deep_check_fallback_model").asString(),
    deep_check_template_id: getValue(rc, "deep_check_template_id").asString(),
    deep_check_search: getValue(rc, "deep_check_search").asBoolean(),
    flag_threshold: getValue(rc, "flag_threshold").asNumber(),
    auto_deep_check: getValue(rc, "auto_deep_check").asBoolean(),
  };
}
