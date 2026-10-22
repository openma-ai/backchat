import type { Settings } from "../shared/settings.js";
import type { Settings as StoredSettings } from "./settings-store.js";

/** The renderer's view of settings: without the telemetry table, which may
 *  hold exporter credentials. */
export function rendererSettings(settings: StoredSettings): Settings {
  const { telemetry: _telemetry, ...rest } = settings;
  return rest;
}
