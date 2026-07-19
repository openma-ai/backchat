/// <reference types="node" />

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ThemePluginModule = {
  THEME_SPEC_VERSION?: number;
  THEME_TOKEN_NAMES?: readonly string[];
  THEME_ASSET_SLOTS?: readonly string[];
  builtInThemes?: ReadonlyArray<{
    specVersion: number;
    id: string;
    name: string;
    author: string;
    appearance: "light" | "dark";
    tokens: Record<string, string>;
    assets?: Record<string, string>;
    layout?: { sidebarWidth?: number };
    presentation?: {
      homeMasthead?: { icon?: string; title: string; subtitle?: string };
      homeHero?: {
        surface?: "framed" | "flush";
        width?: "content" | "bleed";
        height?: number;
      };
      homeSlogan?: {
        text: string | { en: string; "zh-CN": string };
        subtitle?: string | { en: string; "zh-CN": string };
        emphasis?: string | { en: string; "zh-CN": string };
        horizontal?: "left" | "center" | "right";
        vertical?: "top" | "center" | "bottom";
        fontFamily?: "display" | "ui";
        fontSize?: number;
        fontWeight?: number;
      };
      homeSuggestions?: {
        width?: "inset" | "composer" | "wide";
        offsetY?: number;
        items?: Array<{
          kind: "understand" | "shape" | "refine" | "unblock";
          label?: string | { en: string; "zh-CN": string };
          description?: string | { en: string; "zh-CN": string };
          prompt?: string | { en: string; "zh-CN": string };
        }>;
        card?: {
          minHeight?: number;
          borderRadius?: number;
          padding?: number;
          iconSize?: number;
          gap?: number;
          align?: "start" | "center";
        };
      };
      homeComposer?: {
        placeholder?: string | { en: string; "zh-CN": string };
        width?: number;
      };
    };
    preview: { background: string; surface: string; foreground: string; accent: string };
  }>;
  getThemePlugin?: (id: string, appearance: "light" | "dark") => { id: string };
  defineThemePlugin?: (plugin: never) => unknown;
  resolveThemeText?: (
    value: string | { en: string; "zh-CN": string } | undefined,
    locale: "en" | "zh-CN",
    fallback: string,
  ) => string;
  resolveThemeMode?: (
    preference: "system" | "light" | "dark",
    systemPrefersDark: boolean,
  ) => "light" | "dark";
  themeStyle?: (
    lightThemeId: string,
    darkThemeId: string,
    preference: "system" | "light" | "dark",
    systemPrefersDark: boolean,
  ) => {
    themeId: string;
    mode: "light" | "dark";
    colorScheme: "light" | "dark";
    tokens: Record<string, string>;
  };
  themeAssetVariables?: (
    assets: Partial<Record<"app-background" | "sidebar-background" | "empty-state", string>>,
  ) => Record<string, string>;
};

type ThemeRuntimeModule = {
  applyThemeToRoot?: (
    lightThemeId: string,
    darkThemeId: string,
    preference: "system" | "light" | "dark",
    systemPrefersDark: boolean,
    root: {
      style: { setProperty(name: string, value: string): void; colorScheme: string };
      classList: { toggle(name: string, force: boolean): void };
      dataset: Record<string, string>;
    },
  ) => void;
};

async function loadThemePlugins(): Promise<ThemePluginModule> {
  const [contract, registry] = await Promise.all([
    import("./theme-plugin").catch(() => ({})),
    import("../themes").catch(() => ({})),
  ]);
  return { ...contract, ...registry } as ThemePluginModule;
}

async function loadThemeRuntime(): Promise<ThemeRuntimeModule> {
  return import("./theme").catch(() => ({}));
}

describe("theme plugin contract", () => {
  it("ships a complete, unique set of built-in theme plugins", async () => {
    const { THEME_SPEC_VERSION, THEME_TOKEN_NAMES, builtInThemes } = await loadThemePlugins();

    expect(THEME_SPEC_VERSION).toBe(1);
    expect(THEME_TOKEN_NAMES).toBeDefined();
    expect(builtInThemes?.length).toBeGreaterThanOrEqual(4);
    expect(new Set(builtInThemes?.map((theme) => theme.id)).size).toBe(
      builtInThemes?.length,
    );

    for (const theme of builtInThemes ?? []) {
      expect(theme.specVersion).toBe(THEME_SPEC_VERSION);
      expect(theme.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(theme.name).not.toBe("");
      expect(theme.author).not.toBe("");
      expect(Object.keys(theme.preview).toSorted()).toEqual(
        ["accent", "background", "foreground", "surface"].toSorted(),
      );
      expect(["light", "dark"]).toContain(theme.appearance);
      expect(Object.keys(theme.tokens).toSorted()).toEqual(
        [...(THEME_TOKEN_NAMES ?? [])].toSorted(),
      );
    }
    expect(new Set(builtInThemes?.map((theme) => theme.appearance))).toEqual(
      new Set(["light", "dark"]),
    );
    expect(builtInThemes?.map((theme) => theme.id)).toContain("rose-garden-light");
  });

  it("rejects incomplete plugins instead of leaking the previous theme", async () => {
    const { defineThemePlugin } = await loadThemePlugins();

    expect(defineThemePlugin).toBeTypeOf("function");
    expect(() =>
      defineThemePlugin?.({
        specVersion: 1,
        id: "broken",
        name: "Broken",
        author: "Test",
        preview: {
          background: "#fff",
          surface: "#eee",
          foreground: "#111",
          accent: "#f00",
        },
        appearance: "light",
        tokens: {},
      } as never),
    ).toThrow(/missing theme tokens/i);
  });

  it("rejects unsupported specs and unsafe home presentation values", async () => {
    const { builtInThemes, defineThemePlugin } = await loadThemePlugins();
    const source = builtInThemes?.find((theme) => theme.id === "backchat-light");
    expect(source).toBeDefined();

    expect(() =>
      defineThemePlugin?.({ ...source, id: "future-theme", specVersion: 2 } as never),
    ).toThrow(/unsupported theme spec version/i);
    expect(() =>
      defineThemePlugin?.({
        ...source,
        id: "duplicate-starters",
        presentation: {
          homeSuggestions: {
            items: [{ kind: "shape" }, { kind: "shape" }],
          },
        },
      } as never),
    ).toThrow(/duplicate suggestion kind/i);
    expect(() =>
      defineThemePlugin?.({
        ...source,
        id: "giant-starter",
        presentation: { homeSuggestions: { card: { minHeight: 900 } } },
      } as never),
    ).toThrow(/minHeight must be between 80 and 320/i);
    expect(() =>
      defineThemePlugin?.({
        ...source,
        id: "unknown-hero-surface",
        presentation: { homeHero: { surface: "card" } },
      } as never),
    ).toThrow(/hero surface must be framed or flush/i);
  });

  it("resolves localized theme copy with a safe product fallback", async () => {
    const { resolveThemeText } = await loadThemePlugins();
    expect(resolveThemeText?.("One language", "zh-CN", "Fallback")).toBe("One language");
    expect(resolveThemeText?.({ en: "Build", "zh-CN": "构建" }, "zh-CN", "Fallback")).toBe("构建");
    expect(resolveThemeText?.(undefined, "en", "Fallback")).toBe("Fallback");
  });

  it("resolves system mode and falls back to the default plugin", async () => {
    const { getThemePlugin, resolveThemeMode, themeStyle } = await loadThemePlugins();

    expect(resolveThemeMode?.("system", true)).toBe("dark");
    expect(resolveThemeMode?.("system", false)).toBe("light");
    expect(resolveThemeMode?.("light", true)).toBe("light");
    expect(getThemePlugin?.("does-not-exist", "light").id).toBe("backchat-light");
    expect(getThemePlugin?.("does-not-exist", "dark").id).toBe("backchat-dark");
    expect(getThemePlugin?.("workbench-light", "dark").id).toBe("backchat-dark");

    const style = themeStyle?.(
      "does-not-exist",
      "workbench-dark",
      "system",
      true,
    );
    expect(style?.themeId).toBe("workbench-dark");
    expect(style?.mode).toBe("dark");
    expect(style?.colorScheme).toBe("dark");
    expect(Object.keys(style?.tokens ?? {}).length).toBeGreaterThan(20);
  });

  it("replaces every visual token and exposes the active theme on the root", async () => {
    const { applyThemeToRoot } = await loadThemeRuntime();
    const properties = new Map<string, string>();
    const classes = new Map<string, boolean>();
    const root = {
      style: {
        colorScheme: "",
        setProperty(name: string, value: string) {
          properties.set(name, value);
        },
      },
      classList: {
        toggle(name: string, force: boolean) {
          classes.set(name, force);
        },
      },
      dataset: {} as Record<string, string>,
    };

    expect(applyThemeToRoot).toBeTypeOf("function");
    applyThemeToRoot?.(
      "workbench-light",
      "workbench-dark",
      "dark",
      false,
      root,
    );

    const { THEME_TOKEN_NAMES, THEME_ASSET_SLOTS } = await loadThemePlugins();
    expect([...properties.keys()].toSorted()).toEqual(
      [
        ...(THEME_TOKEN_NAMES ?? []).map((name) => `--${name}`),
        ...(THEME_ASSET_SLOTS ?? []).map((name) => `--theme-asset-${name}`),
      ].toSorted(),
    );
    expect(root.dataset.theme).toBe("workbench-dark");
    expect(root.dataset.themeMode).toBe("dark");
    expect(classes.get("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("maps optional images into fixed asset slots and clears missing slots", async () => {
    const { THEME_ASSET_SLOTS, themeAssetVariables } = await loadThemePlugins();

    expect(THEME_ASSET_SLOTS).toEqual([
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
    ]);
    expect(themeAssetVariables).toBeTypeOf("function");
    expect(themeAssetVariables?.({
      "app-background": "file:///themes/stars.png",
      "empty-state": "data:image/svg+xml,hello",
    })).toEqual({
      "--theme-asset-app-background": 'url("file:///themes/stars.png")',
      "--theme-asset-sidebar-background": "none",
      "--theme-asset-empty-state": 'url("data:image/svg+xml,hello")',
      "--theme-asset-home-hero-background": "none",
      "--theme-asset-home-corner-decoration": "none",
      "--theme-asset-suggestion-understand-icon": "none",
      "--theme-asset-suggestion-understand-background": "none",
      "--theme-asset-suggestion-shape-icon": "none",
      "--theme-asset-suggestion-shape-background": "none",
      "--theme-asset-suggestion-refine-icon": "none",
      "--theme-asset-suggestion-refine-background": "none",
      "--theme-asset-suggestion-unblock-icon": "none",
      "--theme-asset-suggestion-unblock-background": "none",
    });
  });

  it("gives Rose Garden a distinct sidebar and replaceable suggestion artwork", async () => {
    const { builtInThemes } = await loadThemePlugins();
    const roseGarden = builtInThemes?.find((theme) => theme.id === "rose-garden-light");

    expect(roseGarden?.assets?.["sidebar-background"]).toBeTruthy();
    expect(roseGarden?.assets?.["sidebar-background"]).not.toBe(
      roseGarden?.assets?.["app-background"],
    );
    expect(roseGarden?.assets?.["home-hero-background"]).toBeTruthy();
    expect(roseGarden?.assets?.["home-corner-decoration"]).toBeTruthy();
    expect(roseGarden?.layout?.sidebarWidth).toBe(276);
    expect(roseGarden?.presentation?.homeMasthead?.title).toBeTruthy();
    expect(roseGarden?.presentation?.homeHero?.surface).toBe("framed");
    expect(roseGarden?.presentation?.homeSlogan?.text).toBeTruthy();
    expect(roseGarden?.presentation?.homeSlogan?.horizontal).toBe("left");
    expect(roseGarden?.presentation?.homeSuggestions?.items).toHaveLength(4);
    expect(roseGarden?.presentation?.homeSuggestions?.card?.iconSize).toBe(52);
    for (const kind of ["understand", "shape", "refine", "unblock"]) {
      expect(roseGarden?.assets?.[`suggestion-${kind}-icon`]).toBeTruthy();
      expect(roseGarden?.assets?.[`suggestion-${kind}-background`]).toBeTruthy();
    }

    const redHorizon = builtInThemes?.find((theme) => theme.id === "red-horizon-light");
    expect(redHorizon?.presentation?.homeHero?.surface).toBe("flush");
    expect(redHorizon?.presentation?.homeHero?.width).toBe("bleed");
    expect(redHorizon?.presentation?.homeHero?.height).toBe(384);
    expect(redHorizon?.presentation?.homeSlogan?.text).toEqual({
      en: "OpenAI is the people's AI.",
      "zh-CN": "OpenAI 是人民的 AI。",
    });
    expect(redHorizon?.presentation?.homeSlogan?.subtitle).toEqual({
      en: "Using advanced tools to create more possibilities for everyone.",
      "zh-CN": "用先进的工具，为每一个人创造更多可能。",
    });
    expect(redHorizon?.presentation?.homeSlogan?.fontFamily).toBe("ui");
    expect(redHorizon?.presentation?.homeSlogan?.fontSize).toBe(48);
    expect(redHorizon?.presentation?.homeSlogan?.fontWeight).toBe(700);
    expect(redHorizon?.presentation?.homeSuggestions?.offsetY).toBe(0);
    expect(redHorizon?.presentation?.homeSuggestions?.items?.map((item) => item.description)).toEqual([
      { en: "Write code and applications", "zh-CN": "编写代码与应用" },
      { en: "Data analysis and insights", "zh-CN": "数据分析与洞察" },
      { en: "Agents and workflows", "zh-CN": "智能体与工作流" },
      { en: "Fix issues and optimize", "zh-CN": "修复问题与优化" },
    ]);
    expect(redHorizon?.presentation?.homeComposer).toEqual({
      placeholder: {
        en: "Type freely. Codex will build the future with you.",
        "zh-CN": "随心输入，Codex 为你构建未来",
      },
      width: 840,
    });
  });
});

describe("theme plugin integration", () => {
  it("auto-discovers isolated theme modules without editing the runtime", () => {
    const registryPath = resolve(__dirname, "../themes/index.ts");
    const backchatLightPath = resolve(__dirname, "../themes/backchat-light.theme.ts");
    const backchatDarkPath = resolve(__dirname, "../themes/backchat-dark.theme.ts");
    const workbenchLightPath = resolve(__dirname, "../themes/workbench-light.theme.ts");
    const workbenchDarkPath = resolve(__dirname, "../themes/workbench-dark.theme.ts");
    const roseGardenPath = resolve(__dirname, "../themes/rose-garden-light.theme.ts");
    const redHorizonPath = resolve(__dirname, "../themes/red-horizon-light.theme.ts");

    expect(existsSync(registryPath)).toBe(true);
    expect(existsSync(backchatLightPath)).toBe(true);
    expect(existsSync(backchatDarkPath)).toBe(true);
    expect(existsSync(workbenchLightPath)).toBe(true);
    expect(existsSync(workbenchDarkPath)).toBe(true);
    expect(existsSync(roseGardenPath)).toBe(true);
    expect(existsSync(redHorizonPath)).toBe(true);
    if (!existsSync(registryPath)) return;

    const registry = readFileSync(registryPath, "utf8");
    expect(registry).toContain("import.meta.glob<ThemeModule>");
    expect(registry).toContain('"./*.theme.ts"');
    expect(registry).toContain("eager: true");
  });

  it("persists separate preferred light and dark theme ids", () => {
    const sharedSettings = readFileSync(
      resolve(__dirname, "../../../shared/settings.ts"),
      "utf8",
    );
    const mainSettings = readFileSync(
      resolve(__dirname, "../../../main/settings-store.ts"),
      "utf8",
    );

    expect(sharedSettings).toContain("light_theme_id: string;");
    expect(sharedSettings).toContain("dark_theme_id: string;");
    expect(mainSettings).toContain(
      'light_theme_id: z.string().min(1).default("backchat-light")',
    );
    expect(mainSettings).toContain(
      'dark_theme_id: z.string().min(1).default("backchat-dark")',
    );
  });

  it("mounts theme synchronization and exposes the plugin picker", () => {
    const entry = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");
    const appearance = readFileSync(
      resolve(__dirname, "../pages/settings/Appearance.tsx"),
      "utf8",
    );

    expect(entry).toContain("<ThemeController />");
    expect(appearance).toContain("themes={lightThemes}");
    expect(appearance).toContain("themes={darkThemes}");
    expect(appearance).toContain("light_theme_id: lightThemeId");
    expect(appearance).toContain("dark_theme_id: darkThemeId");
    expect(appearance).toContain("onValueChange={onChange}");
    expect(appearance).toContain('aria-pressed={selected}');
  });

  it("propagates plugin changes into embedded and terminal surfaces", () => {
    const terminal = readFileSync(
      resolve(__dirname, "../components/shell/BottomPanel.tsx"),
      "utf8",
    );
    const mcpApp = readFileSync(
      resolve(__dirname, "../components/chat/McpAppView.tsx"),
      "utf8",
    );
    const visualization = readFileSync(
      resolve(__dirname, "../components/chat/InlineVisualizationView.tsx"),
      "utf8",
    );
    const appShell = readFileSync(
      resolve(__dirname, "../components/shell/AppShell.tsx"),
      "utf8",
    );
    const chatView = readFileSync(
      resolve(__dirname, "../components/chat/ChatView.tsx"),
      "utf8",
    );
    const homeSuggestions = readFileSync(
      resolve(__dirname, "../components/chat/HomeSuggestions.tsx"),
      "utf8",
    );
    const themeRuntime = readFileSync(
      resolve(__dirname, "theme.ts"),
      "utf8",
    );

    expect(terminal).toContain("`${t.id}-${themeId}-${effective}`");
    expect(mcpApp).toContain("theme: effective");
    expect(mcpApp).toContain("const { effective } = useTheme()");
    expect(visualization).toContain("settings?.appearance.light_theme_id");
    expect(visualization).toContain("settings?.appearance.dark_theme_id");
    expect(appShell).toContain('className="theme-app-background"');
    expect(appShell).toContain("theme-sidebar-background");
    expect(homeSuggestions).toContain('className="theme-empty-state-art"');
    expect(homeSuggestions).toContain("configuredSuggestions.map");
    expect(homeSuggestions).toContain('data-slot="home-suggestions"');
    expect(homeSuggestions).toContain("<OpenmaHomeMark />");
    expect(chatView).toContain("<EmptyStateIntro");
    expect(chatView).toContain('className="home-corner-decoration"');
    expect(chatView).toContain("home-empty-stage");
    expect(chatView).toContain("home-empty-stack");
    expect(chatView).toContain("home-composer-stack");
    expect(homeSuggestions).toContain("home-suggestion-label");
    expect(homeSuggestions).not.toContain("home-suggestion-label mt-auto");
    expect(homeSuggestions).toContain("home-theme-masthead");
    expect(homeSuggestions).toContain("data-home-hero-surface");
    expect(appShell).toContain("layout?.sidebarWidth");
    expect(themeRuntime).toContain('attributeFilter: ["data-theme-mode", "data-theme"]');
    expect(themeRuntime).toContain("activeThemeId");
    const styles = readFileSync(resolve(__dirname, "../styles/index.css"), "utf8");
    expect(styles).toContain("--home-composer-width: 42rem;");
    expect(styles).toContain("--home-composer-width: 880px;");
    expect(styles).toContain("max-width: var(--home-composer-width);");
    expect(styles).toContain("max-width: calc(var(--home-composer-width) - 32px);");
    expect(styles).toContain("min-height: clamp(480px, 58vh, 620px)");
    expect(styles).toContain('[data-home-hero-surface="framed"]');
    expect(styles).toContain('[data-home-hero-surface="flush"]');
    expect(styles).toContain("min-height: var(--home-suggestion-card-height, 148px)");
    expect(styles).toContain(".home-suggestion-card {\n  min-height: var(--home-suggestion-card-height, 112px);");
    expect(styles).toContain(".home-suggestion-fallback-icon {\n  width: var(--home-suggestion-icon-size, 22px);");
    expect(styles).toContain("width: var(--home-suggestion-icon-size, 52px)");
    expect(styles).toContain("gap: var(--home-suggestion-gap, 24px);");
    expect(styles).toContain("justify-content: center;");
    expect(styles).not.toContain(
      'html[data-theme-asset-home-hero-background="true"] .home-composer-stack .composer-card',
    );
    expect(styles).not.toContain("margin-top: 12px !important");
  });

  it("uses the repository OpenMA artwork instead of an invented mark", () => {
    const markComponent = readFileSync(
      resolve(__dirname, "../components/OpenmaHomeMark.tsx"),
      "utf8",
    );
    const markAsset = readFileSync(
      resolve(__dirname, "../assets/openma-logo-mark.svg"),
      "utf8",
    );

    expect(markComponent).toContain('openma-logo-mark.svg');
    expect(markComponent).not.toContain('openma-orbit-mark.svg');
    expect(markAsset).toContain('build/icon.png');
    expect(markAsset).toContain('M279 363');
    expect(markAsset).not.toContain('open-managed-agents');
    expect(existsSync(resolve(__dirname, "../assets/openma-app-icon.svg"))).toBe(false);
  });

  it("uses a coherent Rose Garden icon family instead of emoji glyphs", () => {
    const iconNames = ["understand", "shape", "refine", "unblock"];
    for (const name of iconNames) {
      const icon = readFileSync(
        resolve(__dirname, `../themes/assets/rose-garden-suggestion-${name}.svg`),
        "utf8",
      );
      expect(icon).toContain('data-icon-family="rose-garden"');
      expect(icon).not.toMatch(/[🧭💡✨🗝️]/u);
    }
  });
});
