import { describe, expect, it } from "vitest";

import { terminalTextOptions } from "./terminal-text-options";

describe("terminalTextOptions", () => {
  it("keeps the previous line height and drops JetBrains for the mono token", () => {
    expect(terminalTextOptions('"WenQuanYi Micro Hei Mono", monospace')).toEqual({
      fontFamily: '"WenQuanYi Micro Hei Mono", monospace',
      fontWeight: 400,
      fontSize: 12,
      lineHeight: 1.25,
    });
  });
});
