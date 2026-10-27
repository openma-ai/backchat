import { describe, expect, test } from "vitest";
import { markdownToPlainText } from "./markdown-plain-text";

describe("markdownToPlainText", () => {
  test("reads a markdown link as its words", () => {
    expect(
      markdownToPlainText("[#65](https://github.com/openma-ai/backchat/issues/65)"),
    ).toBe("#65");
    expect(
      markdownToPlainText("fix [#65](https://github.com/openma-ai/backchat/issues/65) now"),
    ).toBe("fix #65 now");
    expect(
      markdownToPlainText("[docs](https://example.com/a \"the docs\")"),
    ).toBe("docs");
  });

  test("keeps a bare url as it is", () => {
    expect(
      markdownToPlainText("https://github.com/openma-ai/backchat/issues/65"),
    ).toBe("https://github.com/openma-ai/backchat/issues/65");
    expect(markdownToPlainText("<https://example.com>")).toBe("https://example.com");
  });

  test("strips the rest of the markdown a title can carry", () => {
    expect(markdownToPlainText("**bold** title")).toBe("bold title");
    expect(markdownToPlainText("*italic* title")).toBe("italic title");
    expect(markdownToPlainText("__bold__ title")).toBe("bold title");
    expect(markdownToPlainText("_italic_ title")).toBe("italic title");
    expect(markdownToPlainText("~~struck~~ title")).toBe("struck title");
    expect(markdownToPlainText("`npm test` failed")).toBe("npm test failed");
    expect(markdownToPlainText("![a screenshot](shot.png)")).toBe("a screenshot");
    expect(markdownToPlainText("# heading")).toBe("heading");
    expect(markdownToPlainText("> quoted")).toBe("quoted");
    expect(markdownToPlainText("- first\n- second")).toBe("first second");
    expect(markdownToPlainText("1. first\n2. second")).toBe("first second");
    expect(markdownToPlainText("<b>bold</b> html")).toBe("bold html");
  });

  test("leaves ordinary words alone", () => {
    expect(markdownToPlainText("snake_case_name")).toBe("snake_case_name");
    expect(markdownToPlainText("2 * 3 * 4")).toBe("2 * 3 * 4");
    expect(markdownToPlainText("[TODO] finish this")).toBe("[TODO] finish this");
    expect(markdownToPlainText("")).toBe("");
  });

  test("folds a multi-line title into one line", () => {
    expect(markdownToPlainText("first line\nsecond line")).toBe("first line second line");
    expect(markdownToPlainText("  padded  ")).toBe("padded");
  });

  test("falls back to the raw title when the markup leaves nothing behind", () => {
    expect(markdownToPlainText("![](shot.png)")).toBe("![](shot.png)");
  });
});
