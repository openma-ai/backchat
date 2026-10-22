import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Body of the first `new MutationObserver(...)` callback in a source file. */
function mutationCallbacks(source: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf("new MutationObserver(", from);
    if (at < 0) return out;
    let depth = 0;
    let i = at + "new MutationObserver".length;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) break;
    }
    out.push(source.slice(at, i + 1));
    from = i;
  }
}

describe("layout reads stay out of DOM mutation callbacks", () => {
  // A MutationObserver fires once per committed batch while a conversation
  // mounts. Reading layout there (getBoundingClientRect, scrollHeight) forces
  // a synchronous reflow inside the commit; opening a chat measured a 453 ms
  // long task with AppShell's measure as one of its largest parts.
  it("AppShell coalesces gutter measurement into the next frame", () => {
    const source = readFileSync(resolve(__dirname, "AppShell.tsx"), "utf8");
    const callbacks = mutationCallbacks(source);
    expect(callbacks.length).toBeGreaterThan(0);
    for (const callback of callbacks) {
      expect(callback).not.toMatch(/\bmeasure\(\)/);
      expect(callback).not.toMatch(/getBoundingClientRect|scrollHeight|offsetWidth/);
    }
  });

  it("ScrollArea boundaries are read once per frame, not per mutation", () => {
    const source = readFileSync(resolve(__dirname, "../ui/scroll-area.tsx"), "utf8");
    for (const callback of mutationCallbacks(source)) {
      expect(callback).not.toMatch(/updateBoundaries\b(?!\))/);
    }
    expect(source).not.toMatch(/new MutationObserver\(updateBoundaries\)/);
    expect(source).not.toMatch(/new ResizeObserver\(updateBoundaries\)/);
  });
});
