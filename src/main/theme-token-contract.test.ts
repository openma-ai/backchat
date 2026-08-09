import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commonDarkTokens, commonLightTokens } from "@openma/common/brand";
import { describe, expect, it } from "vitest";

describe("theme token contract", () => {
  it("derives product semantics from complete theme plugins", () => {
    const css = readFileSync(
      resolve(__dirname, "../renderer/src/styles/index.css"),
      "utf-8",
    );
    const plugins = readFileSync(
      resolve(__dirname, "../renderer/src/lib/theme-plugin.ts"),
      "utf-8",
    );
    const message = readFileSync(
      resolve(__dirname, "../renderer/src/components/ai-elements/message.tsx"),
      "utf-8",
    );

    expect(plugins).toContain('from "@openma/common/brand"');
    expect(plugins).toContain("const backchatLight: ThemeTokens = {");
    expect(plugins).toContain("...commonLightTokens,");
    expect(plugins).toContain("const backchatDark: ThemeTokens = {");
    expect(plugins).toContain("...commonDarkTokens,");
    expect(commonLightTokens).toMatchObject({
      bg: "oklch(0.995 0 0)",
      "bg-sidebar": "oklch(0.965 0.002 95)",
      "bg-surface": "oklch(0.982 0.001 95)",
      "bg-bubble": "oklch(0.955 0.0015 95)",
      fg: "oklch(0.19 0.002 80)",
      "fg-muted": "oklch(0.45 0.002 85)",
      border: "oklch(0.9 0.0015 95)",
    });
    expect(commonDarkTokens).toMatchObject({
      bg: "oklch(0.215 0.002 85)",
      "bg-sidebar": "oklch(0.17 0.0015 85)",
      "bg-surface": "oklch(0.265 0.0025 85)",
      "bg-bubble": "oklch(0.305 0.0025 85)",
      fg: "oklch(0.94 0.0015 95)",
      "fg-muted": "oklch(0.74 0.002 90)",
      border: "oklch(0.33 0.0025 85)",
    });
    expect(css).not.toContain("--bg: oklch(0.995 0 0);");
    expect(css).not.toContain("--bg: oklch(0.215 0.002 85);");
    expect(css).toContain("--surface-canvas: var(--bg);");
    expect(css).toContain("--surface-panel: var(--bg-surface);");
    expect(css).toContain("--surface-raised: var(--bg-bubble);");
    expect(css).toContain("--control-height-compact: 28px;");
    expect(css).toContain("--control-icon-size: 14px;");
    expect(css).toContain(
      "--composer-card-padding-inline: var(--composer-card-padding-block);",
    );
    expect(css).toContain(
      "--composer-footer-gap: calc(var(--bottom-bar-gap-y) - 1px);",
    );
    expect(css).toContain("--composer-menu-width: 280px;");
    expect(css).toContain("--control-bg-hover:");
    expect(css).toContain("--control-bg-open:");
    expect(css).toContain("--focus-ring: var(--border-strong);");
    expect(css).toContain("--color-ring: var(--focus-ring);");
    expect(css).toContain("--color-sidebar-ring: var(--focus-ring);");
    expect(css).not.toContain("--color-ring: var(--ring);");
    expect(css).not.toContain("outline: 2px solid var(--ring);");
    expect(css).not.toContain("--control-focus-ring: color-mix(in srgb, var(--ring)");
    expect(css).toContain(".app-canvas-surface {");
    expect(css).toContain(".app-panel-surface,");
    expect(css).toContain(".app-raised-surface,");
    expect(css).not.toContain("backdrop-filter:");
    expect(css).toContain("--color-bg-bubble: var(--bg-bubble);");
    expect(message).toContain("group-[.is-user]:bg-bg-bubble");
  });
});
