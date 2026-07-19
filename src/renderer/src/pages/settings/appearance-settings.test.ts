import { describe, expect, it } from "vitest";
import type { SettingsAppearance } from "@shared/settings.js";
import { mergeAppearanceSettings } from "./appearance-settings";

const currentAppearance: SettingsAppearance = {
  light_theme_id: "default",
  dark_theme_id: "red-horizon",
  theme: "system",
  language: "system",
  font_size: "md",
  density: "default",
};

describe("mergeAppearanceSettings", () => {
  it("changes the requested preference without dropping other appearance settings", () => {
    expect(
      mergeAppearanceSettings(currentAppearance, { language: "zh-CN" }),
    ).toEqual({
      ...currentAppearance,
      language: "zh-CN",
    });
  });

  it("returns a new settings value instead of mutating the current snapshot", () => {
    const next = mergeAppearanceSettings(currentAppearance, { theme: "dark" });

    expect(next).not.toBe(currentAppearance);
    expect(currentAppearance.theme).toBe("system");
    expect(next.theme).toBe("dark");
  });
});
