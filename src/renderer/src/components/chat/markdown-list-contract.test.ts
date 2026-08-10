import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ASSISTANT_MARKDOWN_CLASS,
  MARKDOWN_BLOCK_RHYTHM,
} from "./ChatMarkdown";

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
    expect(MARKDOWN_BLOCK_RHYTHM).toContain("[&_ul]:list-disc");
    expect(MARKDOWN_BLOCK_RHYTHM).toContain("[&_ol]:list-decimal");
    // A direct-child list rule silently misses anything one level deeper.
    expect(MARKDOWN_BLOCK_RHYTHM).not.toContain("[&>ul]:list-disc");
    expect(MARKDOWN_BLOCK_RHYTHM).not.toContain("[&>ol]:list-decimal");
    expect(ASSISTANT_MARKDOWN_CLASS).toContain(MARKDOWN_BLOCK_RHYTHM);
  });

  it("gives both renderers one source for the block rhythm", () => {
    // The two surfaces used to carry near-twin copies of these rules, which is
    // how they came to disagree about headings, list items and tables by more
    // than a hundred pixels on the same document.
    const streaming = readFileSync(
      resolve(__dirname, "StreamingMarkdown.tsx"),
      "utf8",
    );
    expect(streaming).toContain("MARKDOWN_BLOCK_RHYTHM");
    expect(streaming).not.toContain("[&_ul]:list-disc");
    expect(streaming).not.toContain("[&>p]:my-1.5");
  });
});
