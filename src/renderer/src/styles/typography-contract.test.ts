import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  backchatDarkTheme,
  backchatLightTheme,
  workbenchDarkTheme,
  workbenchLightTheme,
  type ThemePlugin,
} from "@/lib/theme-plugin";
import {
  DISABLED_ENABLED_GAP,
  DISABLED_SURFACE_CONTRAST,
  TEXT_CONTRAST_SURFACES,
  TEXT_ROLE_MIN_GAP,
  WCAG_AA_NORMAL_TEXT,
  contrastRatio,
  disabledForeground,
} from "@/lib/text-roles";

const rendererRoot = fileURLToPath(new URL("..", import.meta.url));
const stylesPath = fileURLToPath(new URL("./index.css", import.meta.url));

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
      continue;
    }
    files.push(path);
  }
  return files;
}

function isSource(path: string): boolean {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return false;
  return /\.(tsx?|css|css\.txt)$/.test(path);
}

function tokensFromThemeFile(path: string): Record<string, string> | null {
  const source = readFileSync(path, "utf8");
  if (!source.includes("const tokens")) return null;
  const names = ["bg", "bg-sidebar", "bg-surface", "fg", "fg-muted", "fg-subtle"] as const;
  const tokens: Record<string, string> = {};
  for (const name of names) {
    const match = source.match(
      new RegExp(`(?:^|\\n)\\s*"?${name}"?\\s*:\\s*"([^"]+)"`),
    );
    if (!match?.[1]) throw new Error(`${path} is missing ${name}`);
    tokens[name] = match[1];
  }
  return tokens;
}

function themeCases(): Array<{ id: string; tokens: Record<string, string> }> {
  const fromPlugins: ThemePlugin[] = [
    backchatLightTheme,
    backchatDarkTheme,
    workbenchLightTheme,
    workbenchDarkTheme,
  ];
  const parsed = walk(join(rendererRoot, "themes"))
    .filter((path) => path.endsWith(".theme.ts"))
    .map((path) => {
      const tokens = tokensFromThemeFile(path);
      return tokens ? { id: relative(rendererRoot, path), tokens } : null;
    })
    .filter((theme): theme is { id: string; tokens: Record<string, string> } => theme !== null);
  return [
    ...fromPlugins.map((theme) => ({ id: theme.id, tokens: theme.tokens })),
    ...parsed,
  ];
}

describe("renderer typography contract", () => {
  const css = readFileSync(stylesPath, "utf8");

  it("defines the UI stack once and keeps a separate slogan serif", () => {
    expect(css.match(/--font-sans:/g)).toEqual(["--font-sans:", "--font-sans:", "--font-sans:"]);
    expect(css.match(/--font-mono:/g)?.length).toBeGreaterThanOrEqual(2);
    expect(css).toContain("--font-chat: var(--font-sans);");
    expect(css).not.toContain("--font-display: var(--font-sans);");
    expect(css).toContain('"Songti SC"');
    expect(css).toContain('"Noto Serif SC"');
    expect(css).toContain("-apple-system-body, -apple-system, BlinkMacSystemFont");
    expect(css).toContain('"Segoe UI Variable"');
    expect(css).toContain('"PingFang SC"');
    expect(css).toContain('"Microsoft YaHei UI"');
    expect(css).toContain('"Backchat Sans"');
    expect(css).toContain('"Backchat Sans SC"');
    expect(css).toContain('"Backchat PingFang"');
    expect(css).toContain('local("PingFang SC Regular")');
    expect(css).toContain('local("PingFangSC-Regular")');
    expect(css).toContain('local("PingFang SC Medium")');
    expect(css).toContain('local("PingFangSC-Medium")');
    expect(css).toContain('local("PingFang SC Semibold")');
    expect(css).toContain('local("PingFangSC-Semibold")');
    expect(css).toContain('"Backchat YaHei"');
    expect(css).toContain('"WenQuanYi Micro Hei Mono"');
    const defaultMono = css.slice(css.indexOf("--font-mono:"), css.indexOf("--font-chat:"));
    expect(defaultMono).toContain('"PingFang SC"');
    expect(defaultMono).toContain('"Microsoft YaHei UI"');
    expect(css).toContain("noto-sans-latin-wght-normal.woff2");
    expect(css).toContain("noto-sans-sc-chinese-simplified-400-normal.woff2");
    expect(css).toContain("noto-sans-sc-chinese-simplified-500-normal.woff2");
    expect(css).toContain("noto-sans-sc-chinese-simplified-600-normal.woff2");
    expect(css).toContain('html[data-os="linux"]');
    expect(css).toContain('html[data-os="windows"]');
    expect(css).toContain("ui-monospace");
    expect(css).not.toContain("system-ui");
    expect(css).not.toContain("Geist");
    expect(css).not.toContain("JetBrains");
    expect(css).not.toContain("Source Serif");
  });

  it("sets the Codex UI weight and the mixed-script rhythm in one place", () => {
    expect(css).toContain("--font-ui-weight: 430;");
    expect(css).toContain("--font-weight-emphasis: 600;");
    expect(css).not.toContain("--font-weight-medium: 600;");
    expect(css).not.toContain("--font-weight-semibold: 700;");
    expect(css).toContain("font-weight: var(--font-ui-weight);");
    expect(css).toContain("font-synthesis: style;");
    expect(css).toContain("font-synthesis: weight style;");
    expect(css).toContain("font-style: italic;");
    expect(css).not.toContain("font-synthesis: none;");
    expect(css).toContain('font-family: "Backchat Sans SC"');
    expect(css).toContain("font-weight: 500;");
    expect(css).toContain("letter-spacing: 0;");
    expect(css).toContain("text-autospace: normal;");
    expect(css).toContain("text-spacing-trim: space-all;");
    expect(css).toContain("line-break: strict;");
    expect(css).toContain("--type-body-leading: 24px;");
    expect(css).toContain("--type-code-leading: 22px;");
    expect(css).toContain('html[lang|="zh"]');
    expect(css).toContain("text-autospace: no-autospace;");
    expect(css).not.toContain("[data-chat-surface] .composer-card textarea:focus-visible");
    expect(css).toContain("color: var(--fg-disabled);");
    expect(css).toContain("opacity: 1;");
    expect(css).toContain("color: var(--fg-subtle);");
    expect(css).toContain(".sidebar-navigation .app-selected-surface");
    expect(css).toContain("noto-sans-latin-ext-wght-normal.woff2");
    expect(css).toContain("font-weight: 100 900;");
    expect(css).toContain("noto-sans-sc-chinese-simplified-500-normal.woff2");
    const projects = readFileSync(
      fileURLToPath(new URL("../pages/projects.css", import.meta.url)),
      "utf8",
    );
    for (const selector of [
      ".projects-empty h2",
      ".project-workers-empty h3",
      ".project-worker-group > h3",
      ".project-worker-title",
    ]) {
      const block = projects.slice(projects.indexOf(selector), projects.indexOf(selector) + 180);
      expect(block, selector).toContain("font-weight: 600;");
      expect(block, selector).not.toContain("font-weight: 500;");
    }
  });

  it("keeps literal font families and hardcoded text colors out of components", () => {
    const violations: string[] = [];
    for (const path of walk(rendererRoot).filter(isSource)) {
      const source = readFileSync(path, "utf8");
      const rel = relative(rendererRoot, path);
      if (/Geist|JetBrains|Source Serif|@fontsource-variable\/geist|@fontsource-variable\/jetbrains/.test(source)) {
        violations.push(`${rel} names a removed font`);
      }
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        const where = `${rel}:${index + 1}`;
    const packagedFace = rel === "styles/index.css" && /font-family:\s*"Backchat /.test(line);
        if (/font-family\s*:/.test(line) && !/var\(--font-/.test(line) && !packagedFace) {
          violations.push(`${where} sets font-family outside the token`);
        }
        const family = /fontFamily\s*:\s*(['"`])([\s\S]*?)\1/.exec(line);
        if (family && family[2] !== "ui" && family[2] !== "display") {
          violations.push(`${where} hardcodes fontFamily`);
        }
        if (
          /(?:^|[\s"'`])text-(?:black|neutral-|zinc-|gray-|slate-|stone-)\b/.test(line) ||
          /text-(?:foreground|fg(?:-muted|-subtle)?|muted-foreground)\/\d/.test(line) ||
          /text-\[(?:#|rgb|hsl|oklch)/.test(line)
        ) {
          violations.push(`${where} hardcodes a text color`);
        }
        const inline = /style=\{\{[^}]*\bcolor:\s*(['"`])([^'"`]*)\1/.exec(line);
        if (inline && !inline[2]?.includes("var(")) {
          violations.push(`${where} hardcodes an inline text color`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("applies the derived disabled role from the theme runtime", () => {
    const themeRuntime = readFileSync(
      fileURLToPath(new URL("../lib/theme.ts", import.meta.url)),
      "utf8",
    );
    expect(themeRuntime).toContain('disabledForeground');
    expect(themeRuntime).toContain('"--fg-disabled"');
  });

  it("keeps every text role at AA with a visible step between roles", () => {
    const cases = themeCases();
    expect(cases.map((theme) => theme.id)).toEqual(
      expect.arrayContaining([
        "backchat-light",
        "backchat-dark",
        "workbench-light",
        "workbench-dark",
      ]),
    );
    expect(cases.length).toBeGreaterThanOrEqual(6);

    for (const theme of cases) {
      const surfaces = TEXT_CONTRAST_SURFACES.map((name) => theme.tokens[name]!);
      const disabled = disabledForeground(theme.tokens.fg!, theme.tokens.bg!, surfaces);
      const roles = {
        fg: theme.tokens.fg!,
        "fg-muted": theme.tokens["fg-muted"]!,
        "fg-subtle": theme.tokens["fg-subtle"]!,
        "fg-disabled": disabled,
      };
      for (const surfaceName of TEXT_CONTRAST_SURFACES) {
        const surface = theme.tokens[surfaceName]!;
        for (const [role, color] of Object.entries(roles)) {
          const floor = role === "fg-disabled" ? DISABLED_SURFACE_CONTRAST : WCAG_AA_NORMAL_TEXT;
          expect(
            contrastRatio(color, surface),
            `${theme.id} ${role} on ${surfaceName}`,
          ).toBeGreaterThanOrEqual(floor);
        }
      }
      expect(
        contrastRatio(roles["fg-subtle"], roles["fg-disabled"]),
        `${theme.id} subtle vs disabled`,
      ).toBeGreaterThanOrEqual(DISABLED_ENABLED_GAP);
      const onCanvas = {
        fg: contrastRatio(roles.fg, theme.tokens.bg!),
        muted: contrastRatio(roles["fg-muted"], theme.tokens.bg!),
        subtle: contrastRatio(roles["fg-subtle"], theme.tokens.bg!),
        disabled: contrastRatio(roles["fg-disabled"], theme.tokens.bg!),
      };
      expect(onCanvas.fg, theme.id).toBeGreaterThan(onCanvas.muted + 1);
      expect(onCanvas.muted, theme.id).toBeGreaterThan(onCanvas.subtle + TEXT_ROLE_MIN_GAP);
      expect(onCanvas.subtle, theme.id).toBeGreaterThan(onCanvas.disabled + TEXT_ROLE_MIN_GAP);
    }
  });
});
