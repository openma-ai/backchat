import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("toast surface", () => {
  it("uses an opaque project token instead of an undefined popover variable", () => {
    const source = readFileSync(resolve(__dirname, "sonner.tsx"), "utf8");
    const styles = readFileSync(resolve(__dirname, "../../styles/index.css"), "utf8");

    expect(source).toContain('"--normal-bg": "var(--bg)"');
    expect(source).not.toContain('"--normal-bg": "var(--popover)"');
    expect(styles).toContain("[data-sonner-toast].cn-toast");
    expect(styles).toContain("background: var(--bg) !important;");
  });
});
