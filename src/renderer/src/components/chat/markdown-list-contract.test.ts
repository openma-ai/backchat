import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ASSISTANT_MARKDOWN_CLASS } from "./ChatMarkdown";

/** One markdown, one appearance.
 *
 * Assistant markdown is painted by two renderers: a DOM-mutating one while the
 * text streams, and a settled one afterwards or for a segment a tool call closed.
 * They styled lists differently — the settled surface set list margins but never
 * restored the markers Tailwind's preflight removes — so the same four bullets
 * arrived as bullets while streaming and as four unmarked paragraphs once
 * settled. Both also used direct-child selectors, which a nested list is not.
 */
describe("markdown lists", () => {
  it("restores markers on the settled assistant surface", () => {
    expect(ASSISTANT_MARKDOWN_CLASS).toContain("[&_ul]:list-disc");
    expect(ASSISTANT_MARKDOWN_CLASS).toContain("[&_ol]:list-decimal");
  });

  it("styles nested lists too, on both renderers", () => {
    const streaming = readFileSync(
      resolve(__dirname, "StreamingMarkdown.tsx"),
      "utf8",
    );

    for (const surface of [ASSISTANT_MARKDOWN_CLASS, streaming]) {
      expect(surface).toContain("[&_ul]:list-disc");
      expect(surface).toContain("[&_ol]:list-decimal");
      // A direct-child list rule silently misses anything one level deeper.
      expect(surface).not.toContain("[&>ul]:list-disc");
      expect(surface).not.toContain("[&>ol]:list-decimal");
    }
  });
});
