export const THEME_TOKEN_NAMES = [
  "brand",
  "brand-hover",
  "brand-subtle",
  "brand-fg",
  "bg",
  "bg-sidebar",
  "bg-surface",
  "bg-bubble",
  "bg-overlay",
  "fg",
  "fg-muted",
  "fg-subtle",
  "border",
  "border-strong",
  "success",
  "success-subtle",
  "warning",
  "warning-subtle",
  "danger",
  "danger-subtle",
  "info",
  "info-subtle",
  "accent-violet",
  "accent-violet-subtle",
  "shadow-md",
  "shadow-sm",
  "shadow-card-soft",
  "shadow-card-press",
  "shadow-input-rest",
  "shadow-chip-press",
  "shadow-pip",
  "ring",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];
export type ThemeTokens = Record<ThemeTokenName, string>;
export type ThemeMode = "light" | "dark";
export type ThemeModePreference = "system" | ThemeMode;
export const THEME_SPEC_VERSION = 1 as const;

export const HOME_SUGGESTION_KINDS = [
  "understand",
  "shape",
  "refine",
  "unblock",
] as const;
export type ThemeHomeSuggestionKind = (typeof HOME_SUGGESTION_KINDS)[number];
export type ThemeLocalizedText = string | { en: string; "zh-CN": string };

export interface ThemeHomeSloganSpec {
  text: ThemeLocalizedText;
  subtitle?: ThemeLocalizedText;
  /** Optional exact substring rendered with the theme accent color. */
  emphasis?: ThemeLocalizedText;
  horizontal?: "left" | "center" | "right";
  vertical?: "top" | "center" | "bottom";
  fontFamily?: "display" | "ui";
  fontSize?: number;
  fontWeight?: number;
}

export interface ThemeHomeSuggestionSpec {
  kind: ThemeHomeSuggestionKind;
  label?: ThemeLocalizedText;
  description?: ThemeLocalizedText;
  prompt?: ThemeLocalizedText;
}

export interface ThemeHomeSuggestionsSpec {
  /** inset follows the composer's corner tangent; composer is edge-to-edge. */
  width?: "inset" | "composer" | "wide";
  /** Moves the card row relative to the hero boundary. Negative values overlap it. */
  offsetY?: number;
  /** Omission keeps the product defaults. Presence controls order and count. */
  items?: ThemeHomeSuggestionSpec[];
  card?: {
    minHeight?: number;
    borderRadius?: number;
    padding?: number;
    iconSize?: number;
    gap?: number;
    align?: "start" | "center";
  };
}

export const THEME_ASSET_SLOTS = [
  "app-background",
  "sidebar-background",
  "empty-state",
  "home-hero-background",
  "home-corner-decoration",
  "suggestion-understand-icon",
  "suggestion-understand-background",
  "suggestion-shape-icon",
  "suggestion-shape-background",
  "suggestion-refine-icon",
  "suggestion-refine-background",
  "suggestion-unblock-icon",
  "suggestion-unblock-background",
] as const;
export type ThemeAssetSlot = (typeof THEME_ASSET_SLOTS)[number];
export type ThemeAssets = Partial<Record<ThemeAssetSlot, string>>;

export interface ThemePlugin {
  /** Exact schema version. Newer contracts must be migrated explicitly. */
  specVersion: typeof THEME_SPEC_VERSION;
  id: string;
  name: string;
  author: string;
  description: string;
  preview: {
    background: string;
    surface: string;
    foreground: string;
    accent: string;
  };
  /** A theme contribution is one concrete light or dark theme. */
  appearance: ThemeMode;
  tokens: ThemeTokens;
  /** Bundled image URLs contributed to fixed, non-interactive UI slots. */
  assets?: ThemeAssets;
  /** Optional shell geometry. Core themes omit this and keep product defaults. */
  layout?: {
    sidebarWidth?: number;
  };
  /** Declarative home presentation. Never executes theme-owned code. */
  presentation?: {
    homeHero?: {
      /** framed is an inset card; flush is an unframed image plane. */
      surface?: "framed" | "flush";
      /** bleed removes the home content inset and spans the full center pane. */
      width?: "content" | "bleed";
      height?: number;
    };
    homeMasthead?: {
      icon?: string;
      title: string;
      subtitle?: string;
    };
    homeSlogan?: ThemeHomeSloganSpec;
    homeSuggestions?: ThemeHomeSuggestionsSpec;
    homeComposer?: {
      placeholder?: ThemeLocalizedText;
      width?: number;
    };
  };
}

export function resolveThemeText(
  value: ThemeLocalizedText | undefined,
  locale: "en" | "zh-CN",
  fallback: string,
): string {
  if (typeof value === "string") return value.trim() || fallback;
  return value?.[locale]?.trim() || fallback;
}

function cssUrl(source: string): string {
  const escaped = source.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `url("${escaped}")`;
}

export function themeAssetVariables(assets: ThemeAssets): Record<string, string> {
  return Object.fromEntries(
    THEME_ASSET_SLOTS.map((slot) => [
      `--theme-asset-${slot}`,
      assets[slot] ? cssUrl(assets[slot]) : "none",
    ]),
  );
}

function validateTokenSet(themeId: string, mode: ThemeMode, tokens: Partial<ThemeTokens>) {
  const missing = THEME_TOKEN_NAMES.filter((name) => !tokens[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Theme "${themeId}" ${mode} mode is missing theme tokens: ${missing.join(", ")}`,
    );
  }
}

export function defineThemePlugin(plugin: ThemePlugin): ThemePlugin {
  if (plugin.specVersion !== THEME_SPEC_VERSION) {
    throw new Error(
      `Unsupported theme spec version ${String(plugin.specVersion)}; expected ${THEME_SPEC_VERSION}`,
    );
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(plugin.id)) {
    throw new Error(`Theme id "${plugin.id}" must use lowercase kebab-case`);
  }
  validateTokenSet(plugin.id, plugin.appearance, plugin.tokens);
  const sidebarWidth = plugin.layout?.sidebarWidth;
  if (sidebarWidth !== undefined && (sidebarWidth < 200 || sidebarWidth > 560)) {
    throw new Error(`Theme "${plugin.id}" sidebar width must be between 200 and 560`);
  }
  const heroSurface = plugin.presentation?.homeHero?.surface;
  if (heroSurface !== undefined && heroSurface !== "framed" && heroSurface !== "flush") {
    throw new Error(`Theme "${plugin.id}" hero surface must be framed or flush`);
  }
  const heroWidth = plugin.presentation?.homeHero?.width;
  if (heroWidth !== undefined && heroWidth !== "content" && heroWidth !== "bleed") {
    throw new Error(`Theme "${plugin.id}" hero width must be content or bleed`);
  }
  validateNumber(plugin.id, "hero height", plugin.presentation?.homeHero?.height, 240, 720);
  const suggestions = plugin.presentation?.homeSuggestions;
  if (suggestions?.items) {
    const seen = new Set<ThemeHomeSuggestionKind>();
    for (const item of suggestions.items) {
      if (!HOME_SUGGESTION_KINDS.includes(item.kind)) {
        throw new Error(`Theme "${plugin.id}" has unknown suggestion kind: ${String(item.kind)}`);
      }
      if (seen.has(item.kind)) {
        throw new Error(`Theme "${plugin.id}" has duplicate suggestion kind: ${item.kind}`);
      }
      seen.add(item.kind);
      validateLocalizedText(plugin.id, `suggestion ${item.kind} label`, item.label);
      validateLocalizedText(plugin.id, `suggestion ${item.kind} description`, item.description);
      validateLocalizedText(plugin.id, `suggestion ${item.kind} prompt`, item.prompt);
    }
  }
  validateLocalizedText(plugin.id, "home slogan", plugin.presentation?.homeSlogan?.text);
  validateLocalizedText(plugin.id, "home slogan subtitle", plugin.presentation?.homeSlogan?.subtitle);
  validateLocalizedText(plugin.id, "home slogan emphasis", plugin.presentation?.homeSlogan?.emphasis);
  validateNumber(plugin.id, "home slogan font size", plugin.presentation?.homeSlogan?.fontSize, 20, 72);
  validateNumber(plugin.id, "home slogan font weight", plugin.presentation?.homeSlogan?.fontWeight, 400, 800);
  validateNumber(plugin.id, "suggestion offsetY", suggestions?.offsetY, -180, 80);
  validateNumber(plugin.id, "minHeight", suggestions?.card?.minHeight, 80, 320);
  validateNumber(plugin.id, "borderRadius", suggestions?.card?.borderRadius, 0, 40);
  validateNumber(plugin.id, "padding", suggestions?.card?.padding, 8, 56);
  validateNumber(plugin.id, "iconSize", suggestions?.card?.iconSize, 16, 96);
  validateNumber(plugin.id, "gap", suggestions?.card?.gap, 0, 64);
  validateLocalizedText(
    plugin.id,
    "home composer placeholder",
    plugin.presentation?.homeComposer?.placeholder,
  );
  validateNumber(
    plugin.id,
    "home composer width",
    plugin.presentation?.homeComposer?.width,
    480,
    1120,
  );
  return plugin;
}

function validateLocalizedText(
  themeId: string,
  field: string,
  value: ThemeLocalizedText | undefined,
) {
  if (value === undefined) return;
  if (typeof value === "string") {
    if (!value.trim()) throw new Error(`Theme "${themeId}" ${field} cannot be empty`);
    return;
  }
  if (!value.en?.trim() || !value["zh-CN"]?.trim()) {
    throw new Error(`Theme "${themeId}" ${field} must provide en and zh-CN`);
  }
}

function validateNumber(
  themeId: string,
  field: string,
  value: number | undefined,
  min: number,
  max: number,
) {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Theme "${themeId}" ${field} must be between ${min} and ${max}`);
  }
}

const backchatLight: ThemeTokens = {
  brand: "#f84f32",
  "brand-hover": "oklch(0.62 0.21 36)",
  "brand-subtle": "oklch(0.97 0.018 36)",
  "brand-fg": "#ffffff",
  bg: "oklch(0.995 0 0)",
  "bg-sidebar": "oklch(0.965 0.002 95)",
  "bg-surface": "oklch(0.982 0.001 95)",
  "bg-bubble": "oklch(0.955 0.0015 95)",
  "bg-overlay": "oklch(0 0 0 / 0.3)",
  fg: "oklch(0.19 0.002 80)",
  "fg-muted": "oklch(0.45 0.002 85)",
  "fg-subtle": "oklch(0.52 0.002 85)",
  border: "oklch(0.9 0.0015 95)",
  "border-strong": "oklch(0.83 0.002 95)",
  success: "oklch(0.6 0.18 145)",
  "success-subtle": "oklch(0.96 0.04 145)",
  warning: "oklch(0.7 0.16 75)",
  "warning-subtle": "oklch(0.96 0.04 75)",
  danger: "oklch(0.58 0.22 25)",
  "danger-subtle": "oklch(0.96 0.04 25)",
  info: "oklch(0.58 0.16 260)",
  "info-subtle": "oklch(0.96 0.03 260)",
  "accent-violet": "oklch(0.55 0.2 300)",
  "accent-violet-subtle": "oklch(0.96 0.03 300)",
  "shadow-md": "0 4px 12px -4px rgb(0 0 0 / 0.12)",
  "shadow-sm": "0 1px 2px -1px rgb(0 0 0 / 0.08)",
  "shadow-card-soft": "0 8px 24px -12px rgb(0 0 0 / 0.10), 0 2px 6px -2px rgb(0 0 0 / 0.04)",
  "shadow-card-press": "0 2px 4px -2px rgb(0 0 0 / 0.08), 0 6px 12px -6px rgb(0 0 0 / 0.08)",
  "shadow-input-rest": "0 1px 2px -1px rgb(0 0 0 / 0.05), 0 4px 8px -6px rgb(0 0 0 / 0.06)",
  "shadow-chip-press": "0 1px 2px -1px rgb(0 0 0 / 0.08)",
  "shadow-pip": "0 18px 48px -18px rgb(0 0 0 / 0.28), 0 4px 14px -6px rgb(0 0 0 / 0.16), inset 0 0 0 1px color-mix(in srgb, var(--border-strong) 65%, transparent)",
  ring: "var(--brand)",
};

const backchatDark: ThemeTokens = {
  brand: "oklch(0.72 0.20 36)",
  "brand-hover": "oklch(0.78 0.20 36)",
  "brand-subtle": "oklch(0.30 0.08 36)",
  "brand-fg": "#1a0e09",
  bg: "oklch(0.215 0.002 85)",
  "bg-sidebar": "oklch(0.17 0.0015 85)",
  "bg-surface": "oklch(0.265 0.0025 85)",
  "bg-bubble": "oklch(0.305 0.0025 85)",
  "bg-overlay": "oklch(0 0 0 / 0.6)",
  fg: "oklch(0.94 0.0015 95)",
  "fg-muted": "oklch(0.74 0.002 90)",
  "fg-subtle": "oklch(0.69 0.002 90)",
  border: "oklch(0.33 0.0025 85)",
  "border-strong": "oklch(0.40 0.003 85)",
  success: "oklch(0.76 0.16 145)",
  "success-subtle": "oklch(0.22 0.05 145)",
  warning: "oklch(0.8 0.14 75)",
  "warning-subtle": "oklch(0.22 0.05 75)",
  danger: "oklch(0.72 0.18 25)",
  "danger-subtle": "oklch(0.22 0.05 25)",
  info: "oklch(0.72 0.14 260)",
  "info-subtle": "oklch(0.22 0.04 260)",
  "accent-violet": "oklch(0.72 0.16 300)",
  "accent-violet-subtle": "oklch(0.22 0.05 300)",
  "shadow-md": "0 4px 12px -2px rgb(0 0 0 / 0.5)",
  "shadow-sm": "0 1px 2px -1px rgb(0 0 0 / 0.4)",
  "shadow-card-soft": "0 8px 24px -12px rgb(0 0 0 / 0.5), 0 2px 6px -2px rgb(0 0 0 / 0.25)",
  "shadow-card-press": "0 2px 4px -2px rgb(0 0 0 / 0.4), 0 6px 12px -6px rgb(0 0 0 / 0.35)",
  "shadow-input-rest": "0 1px 2px -1px rgb(0 0 0 / 0.3), 0 4px 8px -6px rgb(0 0 0 / 0.25)",
  "shadow-chip-press": "0 1px 2px -1px rgb(0 0 0 / 0.35)",
  "shadow-pip": "0 20px 52px -18px rgb(0 0 0 / 0.78), 0 5px 16px -7px rgb(0 0 0 / 0.7), inset 0 0 0 1px color-mix(in srgb, var(--border-strong) 72%, transparent)",
  ring: "var(--brand)",
};

const workbenchLight: ThemeTokens = {
  ...backchatLight,
  brand: "oklch(0.54 0.17 252)",
  "brand-hover": "oklch(0.48 0.17 252)",
  "brand-subtle": "oklch(0.95 0.035 252)",
  "brand-fg": "#ffffff",
  bg: "oklch(0.985 0.004 250)",
  "bg-sidebar": "oklch(0.94 0.008 250)",
  "bg-surface": "oklch(0.965 0.006 250)",
  "bg-bubble": "oklch(0.925 0.01 250)",
  fg: "oklch(0.20 0.018 255)",
  "fg-muted": "oklch(0.43 0.02 255)",
  "fg-subtle": "oklch(0.50 0.018 255)",
  border: "oklch(0.86 0.015 250)",
  "border-strong": "oklch(0.76 0.022 250)",
  info: "oklch(0.54 0.17 252)",
  "info-subtle": "oklch(0.95 0.035 252)",
};

const workbenchDark: ThemeTokens = {
  ...backchatDark,
  brand: "oklch(0.72 0.14 248)",
  "brand-hover": "oklch(0.78 0.13 248)",
  "brand-subtle": "oklch(0.30 0.07 248)",
  "brand-fg": "oklch(0.16 0.03 250)",
  bg: "oklch(0.22 0.018 255)",
  "bg-sidebar": "oklch(0.17 0.02 255)",
  "bg-surface": "oklch(0.27 0.022 255)",
  "bg-bubble": "oklch(0.32 0.025 255)",
  fg: "oklch(0.94 0.008 250)",
  "fg-muted": "oklch(0.74 0.018 250)",
  "fg-subtle": "oklch(0.68 0.018 250)",
  border: "oklch(0.35 0.025 255)",
  "border-strong": "oklch(0.44 0.03 255)",
  info: "oklch(0.72 0.14 248)",
  "info-subtle": "oklch(0.25 0.06 248)",
};

export const backchatLightTheme = defineThemePlugin({
    specVersion: THEME_SPEC_VERSION,
    id: "backchat-light",
    name: "Backchat Light",
    author: "Backchat",
    description: "Neutral work surfaces with the original vermilion accent.",
    preview: {
      background: "#fefefe",
      surface: "#f4f3f1",
      foreground: "#20201f",
      accent: "#f84f32",
    },
    appearance: "light",
    tokens: backchatLight,
  });

export const backchatDarkTheme = defineThemePlugin({
    specVersion: THEME_SPEC_VERSION,
    id: "backchat-dark",
    name: "Backchat Dark",
    author: "Backchat",
    description: "Neutral dark work surfaces with a warm vermilion accent.",
    preview: {
      background: "#252423",
      surface: "#343332",
      foreground: "#eeedeb",
      accent: "#f47958",
    },
    appearance: "dark",
    tokens: backchatDark,
  });

export const workbenchLightTheme = defineThemePlugin({
    specVersion: THEME_SPEC_VERSION,
    id: "workbench-light",
    name: "Workbench Light",
    author: "Backchat",
    description: "A cool, focused light palette for long editor sessions.",
    preview: {
      background: "#f7f8fa",
      surface: "#e9edf2",
      foreground: "#252b35",
      accent: "#3377c9",
    },
    appearance: "light",
    tokens: workbenchLight,
  });

export const workbenchDarkTheme = defineThemePlugin({
    specVersion: THEME_SPEC_VERSION,
    id: "workbench-dark",
    name: "Workbench Dark",
    author: "Backchat",
    description: "A cool, focused palette for long editor sessions.",
    preview: {
      background: "#1f2530",
      surface: "#2b3442",
      foreground: "#edf1f7",
      accent: "#6aa8ee",
    },
    appearance: "dark",
    tokens: workbenchDark,
  });

export function resolveThemeMode(
  preference: ThemeModePreference,
  systemPrefersDark: boolean,
): ThemeMode {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}
