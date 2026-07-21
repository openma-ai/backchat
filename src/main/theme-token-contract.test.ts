import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commonDarkTokens, commonLightTokens } from "@openma/common/brand";
import { describe, expect, it } from "vitest";

describe("theme token contract", () => {
  it("keeps default values in common and CSS limited to semantic consumers", () => {
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
    expect(plugins).toContain("const backchatLight: ThemeTokens = { ...commonLightTokens }");
    expect(plugins).toContain("const backchatDark: ThemeTokens = { ...commonDarkTokens }");
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
    expect(css).toContain(
      "background: color-mix(in srgb, var(--bg-surface) 70%, transparent);",
    );
    expect(css).toContain("--color-bg-bubble: var(--bg-bubble);");
    expect(message).toContain("group-[.is-user]:bg-bg-bubble");
  });
});
