import type { SettingsAppearance } from "@shared/settings.js";

export function mergeAppearanceSettings(
  current: SettingsAppearance,
  patch: Partial<SettingsAppearance>,
): SettingsAppearance {
  return { ...current, ...patch };
}
