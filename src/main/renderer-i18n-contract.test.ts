import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** Every label a user or a screen reader reads has to come from the translator.
 *
 * The interface used to respect the language setting everywhere except the parts
 * that describe what the agent is doing, and the omission looked deliberate
 * because it was invisible to anyone reading in the default language. A literal
 * in one of these attributes is the exact shape of that regression, so this
 * refuses the whole class rather than the instances that were found once.
 */
const RENDERER = resolve(__dirname, "../renderer/src");
const LITERAL_ATTRIBUTE = /(placeholder|aria-label|title)="([A-Z][^"]*)"/g;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    if (!path.endsWith(".tsx") || path.includes(".test.")) return [];
    return [path];
  });
}

describe("renderer i18n", () => {
  it("has no hardcoded label literals left in the interface", () => {
    const offenders = tsxFiles(RENDERER).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(LITERAL_ATTRIBUTE)].map(
        (match) => `${path.slice(RENDERER.length + 1)}: ${match[0]}`,
      );
    });

    expect(offenders).toEqual([]);
  });
});
