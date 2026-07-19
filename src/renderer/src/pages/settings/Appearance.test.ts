/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("appearance settings information architecture", () => {
  it("uses mode previews, compact plugin selectors, and a live theme preview", () => {
    const source = readFileSync(resolve(__dirname, "Appearance.tsx"), "utf8");

    expect(source).toContain("AppearanceModeCard");
    expect(source).toContain("ThemeSelect");
    expect(source).toContain("ThemeWorkbenchPreview");
    expect(source).toContain("grid-cols-3");
    expect(source).not.toContain("function ThemeCard");
  });
});
