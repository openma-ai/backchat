import { describe, expect, it } from "vitest";

import { cssFontFamily } from "./css-font";

describe("cssFontFamily", () => {
  it("falls back when there is no document", () => {
    expect(cssFontFamily("--font-mono")).toBe("ui-monospace, monospace");
    expect(cssFontFamily("--font-sans")).toBe("sans-serif");
  });

  it("reads the computed family and falls back when it is empty", () => {
    const probe = {
      style: {} as { fontFamily?: string; position?: string; visibility?: string },
      remove: () => undefined,
    };
    const documentMock = {
      createElement: () => probe,
      documentElement: { appendChild: () => undefined },
    };
    const previous = globalThis.document;
    Object.assign(globalThis, { document: documentMock });
    const styles = new Map<string, string>([
      ['var(--font-mono)', '"WenQuanYi Micro Hei Mono", monospace'],
      ['var(--font-sans)', ""],
    ]);
    const getComputedStyle = (element: typeof probe) => ({
      fontFamily: styles.get(element.style.fontFamily ?? "") ?? "",
    });
    const previousStyle = globalThis.getComputedStyle;
    Object.assign(globalThis, { getComputedStyle });
    try {
      expect(cssFontFamily("--font-mono")).toBe('"WenQuanYi Micro Hei Mono", monospace');
      styles.set("var(--font-mono)", "");
      expect(cssFontFamily("--font-mono")).toBe("ui-monospace, monospace");
      expect(cssFontFamily("--font-sans")).toBe("sans-serif");
    } finally {
      if (previous === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        Object.assign(globalThis, { document: previous });
      }
      if (previousStyle === undefined) {
        delete (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
      } else {
        Object.assign(globalThis, { getComputedStyle: previousStyle });
      }
    }
  });
});
