import { useCallback, useEffect, useState } from "react";
import {
  THEME_TOKEN_NAMES,
  THEME_ASSET_SLOTS,
  themeAssetVariables,
  type ThemeModePreference,
} from "@/lib/theme-plugin";
import { themeStyle } from "@/themes";
import { getSettings, patchSettings, useSettings } from "@/lib/settings-store";

export const THEME_LIGHT_ID_STORAGE_KEY = "theme-light-id";
export const THEME_DARK_ID_STORAGE_KEY = "theme-dark-id";
export const THEME_MODE_STORAGE_KEY = "theme";
const LEGACY_THEME_ID_STORAGE_KEY = "theme-id";
const DEFAULT_LIGHT_THEME_ID = "backchat-light";
const DEFAULT_DARK_THEME_ID = "backchat-dark";

export interface ThemeRoot {
  style: {
    setProperty(name: string, value: string): void;
    colorScheme: string;
  };
  classList: {
    toggle(name: string, force: boolean): void;
  };
  dataset: Record<string, string | undefined>;
}

/** Apply one complete plugin token set. No values are inherited from the
 * previously active plugin, so switching themes cannot leave stale colors. */
export function applyThemeToRoot(
  lightThemeId: string,
  darkThemeId: string,
  preference: ThemeModePreference,
  systemPrefersDark: boolean,
  root: ThemeRoot,
) {
  const next = themeStyle(lightThemeId, darkThemeId, preference, systemPrefersDark);
  for (const name of THEME_TOKEN_NAMES) {
    root.style.setProperty(`--${name}`, next.tokens[name]);
  }
  const assetVariables = themeAssetVariables(next.assets);
  for (const [name, value] of Object.entries(assetVariables)) {
    root.style.setProperty(name, value);
  }
  for (const slot of THEME_ASSET_SLOTS) {
    const datasetKey = `themeAsset${slot
      .split("-")
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join("")}`;
    root.dataset[datasetKey] = next.assets[slot] ? "true" : "false";
  }
  root.dataset.theme = next.themeId;
  root.dataset.themeMode = next.mode;
  root.classList.toggle("dark", next.mode === "dark");
  root.style.colorScheme = next.colorScheme;
}

export function applyThemeSelection(
  lightThemeId: string,
  darkThemeId: string,
  preference: ThemeModePreference,
) {
  const systemPrefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  applyThemeToRoot(
    lightThemeId,
    darkThemeId,
    preference,
    systemPrefersDark,
    document.documentElement,
  );
}

export function persistThemeSelection(
  lightThemeId: string,
  darkThemeId: string,
  preference: ThemeModePreference,
) {
  localStorage.setItem(THEME_LIGHT_ID_STORAGE_KEY, lightThemeId);
  localStorage.setItem(THEME_DARK_ID_STORAGE_KEY, darkThemeId);
  if (preference === "system") localStorage.removeItem(THEME_MODE_STORAGE_KEY);
  else localStorage.setItem(THEME_MODE_STORAGE_KEY, preference);
}

export function applyStoredTheme() {
  const legacyThemeId = localStorage.getItem(LEGACY_THEME_ID_STORAGE_KEY);
  const lightThemeId = localStorage.getItem(THEME_LIGHT_ID_STORAGE_KEY) ||
    (legacyThemeId === "workbench" ? "workbench-light" : DEFAULT_LIGHT_THEME_ID);
  const darkThemeId = localStorage.getItem(THEME_DARK_ID_STORAGE_KEY) ||
    (legacyThemeId === "workbench" ? "workbench-dark" : DEFAULT_DARK_THEME_ID);
  const storedMode = localStorage.getItem(THEME_MODE_STORAGE_KEY);
  const preference: ThemeModePreference =
    storedMode === "light" || storedMode === "dark" ? storedMode : "system";
  applyThemeSelection(lightThemeId, darkThemeId, preference);
}

/** Compatibility hook for UI surfaces that need the effective mode or expose
 * a quick mode toggle. Durable changes still flow through the settings store. */
export function useTheme() {
  const settings = useSettings();
  const [effective, setEffective] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.themeMode === "dark" ? "dark" : "light",
  );
  const [activeThemeId, setActiveThemeId] = useState<string | undefined>(() =>
    document.documentElement.dataset.theme
  );
  const theme = settings?.appearance.theme ?? "system";
  const lightThemeId = settings?.appearance.light_theme_id ??
    localStorage.getItem(THEME_LIGHT_ID_STORAGE_KEY) ?? DEFAULT_LIGHT_THEME_ID;
  const darkThemeId = settings?.appearance.dark_theme_id ??
    localStorage.getItem(THEME_DARK_ID_STORAGE_KEY) ?? DEFAULT_DARK_THEME_ID;
  const themeId = activeThemeId ??
    (effective === "dark" ? darkThemeId : lightThemeId);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      setEffective(root.dataset.themeMode === "dark" ? "dark" : "light");
      setActiveThemeId(root.dataset.theme);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme-mode", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const setTheme = useCallback((preference: ThemeModePreference) => {
    const current = getSettings();
    if (current) {
      void patchSettings({
        appearance: { ...current.appearance, theme: preference },
      });
      return;
    }
    const lightThemeId = localStorage.getItem(THEME_LIGHT_ID_STORAGE_KEY) ||
      DEFAULT_LIGHT_THEME_ID;
    const darkThemeId = localStorage.getItem(THEME_DARK_ID_STORAGE_KEY) ||
      DEFAULT_DARK_THEME_ID;
    persistThemeSelection(lightThemeId, darkThemeId, preference);
    applyThemeSelection(lightThemeId, darkThemeId, preference);
  }, []);

  return { themeId, lightThemeId, darkThemeId, theme, effective, setTheme } as const;
}
