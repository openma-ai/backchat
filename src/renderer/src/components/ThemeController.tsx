import { useEffect } from "react";
import { useSettings } from "@/lib/settings-store";
import { applyThemeSelection, persistThemeSelection } from "@/lib/theme";

/** Keeps the renderer, secondary windows, and OS color-scheme changes on the
 * same theme selection. The main-process settings file remains authoritative. */
export function ThemeController() {
  const settings = useSettings();
  const lightThemeId = settings?.appearance.light_theme_id;
  const darkThemeId = settings?.appearance.dark_theme_id;
  const mode = settings?.appearance.theme;

  useEffect(() => {
    if (!lightThemeId || !darkThemeId || !mode) return;

    const apply = () => applyThemeSelection(lightThemeId, darkThemeId, mode);
    apply();
    persistThemeSelection(lightThemeId, darkThemeId, mode);

    if (mode !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [darkThemeId, lightThemeId, mode]);

  return null;
}
