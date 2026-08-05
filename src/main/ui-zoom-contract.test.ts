import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop UI zoom and chrome geometry", () => {
  it("starts one existing zoom step above actual size", () => {
    const main = readFileSync(resolve(__dirname, "index.ts"), "utf8");

    expect(main).toContain("const DEFAULT_UI_ZOOM_FACTOR = 1.15;");
    expect(main).toContain(
      "void win.webContents.setZoomFactor(DEFAULT_UI_ZOOM_FACTOR);",
    );
  });

  it("starts the collapsed title after the sidebar and history controls", () => {
    const shell = readFileSync(
      resolve(__dirname, "../renderer/src/components/shell/AppShell.tsx"),
      "utf8",
    );
    const css = readFileSync(
      resolve(__dirname, "../renderer/src/styles/index.css"),
      "utf8",
    );

    expect(css).toContain("--sidebar-toggle-left:");
    expect(css).toContain("--chrome-history-left: calc(");
    expect(css).toContain("--left-chrome-end: calc(");
    expect(css).toContain("--chrome-title-gap: 12px;");
    expect(shell).toContain('left: "var(--sidebar-toggle-left)"');
    expect(shell).toContain(
      '"calc(var(--left-chrome-end) + var(--chrome-title-gap))"',
    );
    expect(shell.match(/top: "var\(--chrome-top\)"/g)).toHaveLength(4);
  });
});
