import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("theme token contract", () => {
  it("keeps visual values in theme plugins and CSS limited to semantic consumers", () => {
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

    expect(plugins).toContain('bg: "oklch(0.995 0 0)"');
    expect(plugins).toContain('"bg-sidebar": "oklch(0.965 0.002 95)"');
    expect(plugins).toContain('"bg-surface": "oklch(0.982 0.001 95)"');
    expect(plugins).toContain('"bg-bubble": "oklch(0.955 0.0015 95)"');
    expect(plugins).toContain('fg: "oklch(0.19 0.002 80)"');
    expect(plugins).toContain('"fg-muted": "oklch(0.45 0.002 85)"');
    expect(plugins).toContain('border: "oklch(0.9 0.0015 95)"');

    expect(plugins).toContain('bg: "oklch(0.215 0.002 85)"');
    expect(plugins).toContain('"bg-sidebar": "oklch(0.17 0.0015 85)"');
    expect(plugins).toContain('"bg-surface": "oklch(0.265 0.0025 85)"');
    expect(plugins).toContain('"bg-bubble": "oklch(0.305 0.0025 85)"');
    expect(plugins).toContain('fg: "oklch(0.94 0.0015 95)"');
    expect(plugins).toContain('"fg-muted": "oklch(0.74 0.002 90)"');
    expect(plugins).toContain('border: "oklch(0.33 0.0025 85)"');
    expect(css).not.toContain("--bg: oklch(0.995 0 0);");
    expect(css).not.toContain("--bg: oklch(0.215 0.002 85);");
    expect(css).toContain(
      "background: color-mix(in srgb, var(--bg-surface) 70%, transparent);",
    );
    expect(css).toContain("--color-bg-bubble: var(--bg-bubble);");
    expect(message).toContain("group-[.is-user]:bg-bg-bubble");
  });
});
