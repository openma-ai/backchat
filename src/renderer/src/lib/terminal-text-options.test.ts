import { describe, expect, it } from "vitest";

import { terminalTextOptions } from "./terminal-text-options";

describe("terminalTextOptions", () => {
  it("uses a 1.0 line box and custom box-drawing glyphs", () => {
    expect(terminalTextOptions('"WenQuanYi Micro Hei Mono", monospace')).toEqual({
      fontFamily: '"WenQuanYi Micro Hei Mono", monospace',
      fontWeight: 400,
      fontSize: 12,
      lineHeight: 1,
      customGlyphs: true,
    });
  });
});
