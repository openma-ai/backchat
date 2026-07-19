import { describe, expect, it } from "vitest";

import {
  buildInlineVisualizationDocument,
  resolveInlineVisualizationTheme,
  splitInlineVisualizations,
} from "./inline-visualization";
import * as inlineVisualization from "./inline-visualization";

describe("inline visualization directives", () => {
  it("splits compatible and native directives out of assistant markdown", () => {
    expect(
      splitInlineVisualizations([
        "Before",
        '::codex-inline-vis{file="latency-chart.html"}',
        "Between",
        '::openma-inline-vis{file="details/queue-lab.html"}',
        "After",
      ].join("\n")),
    ).toEqual([
      { kind: "markdown", text: "Before\n" },
      { kind: "visualization", file: "latency-chart.html" },
      { kind: "markdown", text: "\nBetween\n" },
      { kind: "visualization", file: "details/queue-lab.html" },
      { kind: "markdown", text: "\nAfter" },
    ]);
  });

  it("leaves unsafe or malformed directives as ordinary markdown", () => {
    const text = [
      '::openma-inline-vis{file="../secret.html"}',
      '::openma-inline-vis{file="/tmp/absolute.html"}',
      '::openma-inline-vis{file="chart.svg"}',
    ].join("\n");

    expect(splitInlineVisualizations(text)).toEqual([{ kind: "markdown", text }]);
  });
});

describe("inline visualization host theme", () => {
  it("maps Backchat's restrained grayscale tokens onto visualization tokens", () => {
    expect(resolveInlineVisualizationTheme({
      "--bg": "oklch(0.21 0 0)",
      "--bg-surface": "oklch(0.27 0 0)",
      "--fg": "oklch(0.94 0 0)",
      "--fg-muted": "oklch(0.72 0 0)",
      "--border": "oklch(0.33 0 0)",
      "--border-strong": "oklch(0.40 0 0)",
      "--danger": "oklch(0.72 0.18 25)",
    })).toMatchObject({
      background: "oklch(0.21 0 0)",
      card: "oklch(0.27 0 0)",
      foreground: "oklch(0.94 0 0)",
      "muted-foreground": "oklch(0.72 0 0)",
      border: "oklch(0.33 0 0)",
      ring: "oklch(0.40 0 0)",
      destructive: "oklch(0.72 0.18 25)",
    });
  });
});

describe("inline visualization sandbox", () => {
  it("wraps a fragment with the Visualize GUI contract, resizing, icons, and follow-up messaging", () => {
    const html = buildInlineVisualizationDocument(
      '<div id="viz"><button class="btn">Inspect</button></div>',
      {
        background: "oklch(1 0 0)",
        foreground: "oklch(0.2 0 0)",
        primary: "oklch(0.3 0 0)",
      },
    );

    expect(html).toContain("default-src 'none'");
    expect(html).toContain("cdnjs.cloudflare.com");
    expect(html).toContain("--background:oklch(1 0 0)");
    expect(html).toContain(".viz-grid");
    expect(html).toContain("@floating-ui/dom@1.7.4");
    expect(html).toContain("lucide@1.17.0");
    expect(html).not.toContain("createIcons() {}");
    expect(html).toContain("ResizeObserver");
    expect(html).toContain("sendFollowUpMessage");
    expect(html).toContain("openma:inline-visualization:resize");
    expect(html).toContain("openma:inline-visualization:follow-up");
    expect(html).toContain('<div id="viz"><button class="btn">Inspect</button></div>');
  });

  it("sizes generative UI to its content instead of imposing MCP card bounds", () => {
    const clampInlineVisualizationHeight = (inlineVisualization as unknown as {
      clampInlineVisualizationHeight?: (height: number) => number;
    }).clampInlineVisualizationHeight;
    expect(typeof clampInlineVisualizationHeight).toBe("function");
    if (!clampInlineVisualizationHeight) return;
    expect(clampInlineVisualizationHeight(36)).toBe(36);
    expect(clampInlineVisualizationHeight(1_240)).toBe(1_240);
    expect(clampInlineVisualizationHeight(Number.NaN)).toBe(1);
    expect(clampInlineVisualizationHeight(9_000)).toBe(4_096);
  });
});
