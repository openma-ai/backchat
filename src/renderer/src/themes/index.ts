import {
  resolveThemeMode,
  type ThemeModePreference,
  type ThemePlugin,
} from "@/lib/theme-plugin";

type ThemeModule = { default: ThemePlugin };

// Adding a *.theme.ts module is the plugin registration step. Vite bundles
// built-in themes eagerly, while the core runtime remains unaware of names.
const modules = import.meta.glob<ThemeModule>("./*.theme.ts", { eager: true });
const discovered = Object.entries(modules).map(([path, module]) => {
  if (!module.default) throw new Error(`Theme module ${path} has no default export`);
  return module.default;
});

const ids = new Set<string>();
for (const theme of discovered) {
  if (ids.has(theme.id)) throw new Error(`Duplicate theme id: ${theme.id}`);
  ids.add(theme.id);
}

export const builtInThemes = Object.freeze(
  discovered.toSorted((a, b) => {
    const aBuiltInRank = a.id.startsWith("backchat-") ? 0 : 1;
    const bBuiltInRank = b.id.startsWith("backchat-") ? 0 : 1;
    if (aBuiltInRank !== bBuiltInRank) return aBuiltInRank - bBuiltInRank;
    if (a.appearance !== b.appearance) return a.appearance.localeCompare(b.appearance);
    return a.name.localeCompare(b.name);
  }),
);

function requiredTheme(id: string): ThemePlugin {
  const theme = builtInThemes.find((candidate) => candidate.id === id);
  if (!theme) throw new Error(`The ${id} theme plugin is required`);
  return theme;
}

const defaultThemes = {
  light: requiredTheme("backchat-light"),
  dark: requiredTheme("backchat-dark"),
};

const themeRegistry = new Map(builtInThemes.map((theme) => [theme.id, theme]));

export function getThemePlugin(id: string, appearance: "light" | "dark"): ThemePlugin {
  const theme = themeRegistry.get(id);
  return theme?.appearance === appearance ? theme : defaultThemes[appearance];
}

export function themeStyle(
  lightThemeId: string,
  darkThemeId: string,
  preference: ThemeModePreference,
  systemPrefersDark: boolean,
) {
  const mode = resolveThemeMode(preference, systemPrefersDark);
  const plugin = getThemePlugin(mode === "light" ? lightThemeId : darkThemeId, mode);
  return {
    themeId: plugin.id,
    mode,
    colorScheme: mode,
    tokens: plugin.tokens,
    assets: plugin.assets ?? {},
  } as const;
}
