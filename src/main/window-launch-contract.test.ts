import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop window launch", () => {
  it("maximizes the first window so launch fills the display", () => {
    const main = readFileSync(resolve(__dirname, "index.ts"), "utf8");

    expect(main).toContain("if (!testHooksEnabled) win.maximize();");
  });
});
