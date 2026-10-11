/**
 * @vitest-environment happy-dom
 *
 * macOS resting UI uses font-weight 430 so SF follows that axis. The
 * PingFang 430 face is the Regular file. Code stays at 400. Heavier
 * elements keep their own weight. happy-dom does not inherit
 * font-variation-settings, but Chromium does, so this test applies the
 * stylesheet's own declarations and then inherits them. An element the
 * stylesheet has never named still has to draw Latin at its font-weight.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "index.css"), "utf8");

interface VariationRule {
  selector: string;
  value: string;
  order: number;
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length - 1;
}

function variationRules(source: string, into: VariationRule[] = []): VariationRule[] {
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (source[i] === "@") {
      const open = source.indexOf("{", i);
      const semi = source.indexOf(";", i);
      if (open === -1 || (semi !== -1 && semi < open)) {
        i = semi === -1 ? source.length : semi + 1;
        continue;
      }
      const close = matchingBrace(source, open);
      const head = source.slice(i, open).trim();
      if (/^@(media|supports|layer)\b/.test(head)) {
        variationRules(source.slice(open + 1, close), into);
      }
      i = close + 1;
      continue;
    }
    const open = source.indexOf("{", i);
    if (open === -1) break;
    const selector = source.slice(i, open).trim();
    const close = matchingBrace(source, open);
    const body = source.slice(open + 1, close);
    const declared = /font-variation-settings\s*:\s*([^;]+)/.exec(body);
    if (selector && declared?.[1]) {
      into.push({ selector, value: declared[1].trim(), order: into.length });
    }
    i = close + 1;
  }
  return into;
}

function specificity(selector: string): [number, number, number] {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const attrs = selector.match(/\[[^\]]+\]|\.[\w-]+/g)?.length ?? 0;
  const elements = selector.match(/(^|[\s>+~])(?:[a-zA-Z*][\w-]*)/g)?.length ?? 0;
  return [ids, attrs, elements];
}

function beats(next: [number, number, number], prev: [number, number, number]): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (next[i] !== prev[i]) return next[i]! > prev[i]!;
  }
  return true;
}

function specifiedVariation(element: Element, rules: VariationRule[]): string | null {
  let winner: { value: string; rank: [number, number, number]; order: number } | null = null;
  for (const rule of rules) {
    let matches = false;
    try {
      matches = element.matches(rule.selector);
    } catch {
      matches = false;
    }
    if (!matches) continue;
    const rank = specificity(rule.selector);
    if (!winner || beats(rank, winner.rank)) {
      winner = { value: rule.value, rank, order: rule.order };
    }
  }
  return winner?.value ?? null;
}

/** Chromium inherits font-variation-settings. A declaration on body reaches
 *  every descendant that does not set its own. */
function inheritedVariation(element: Element | null, rules: VariationRule[]): string {
  if (!element) return "normal";
  return specifiedVariation(element, rules) ?? inheritedVariation(element.parentElement, rules);
}

function latinAxis(element: Element, rules: VariationRule[]): number {
  const weight = Number.parseFloat(getComputedStyle(element).fontWeight);
  const pinned = /wght["']?\s+([0-9.]+)/i.exec(inheritedVariation(element, rules));
  return pinned ? Number(pinned[1]) : weight;
}

describe("macOS Latin follows font-weight", () => {
  it("draws an arbitrary heavier element at that weight, not at a resting axis", () => {
    document.documentElement.dataset.os = "mac";
    document.head.innerHTML = `<style>${css}</style>`;
    document.body.innerHTML = `
      <div data-chat-surface>
        <div class="chat-markdown">
          <table><thead><tr><th id="header">Column</th></tr></thead></table>
          <pre><code id="code">const x = 1</code></pre>
        </div>
      </div>
    `;
    const tag = `x-bold-${crypto.randomUUID().replaceAll("-", "")}`;
    const bold = document.createElement(tag);
    bold.style.fontWeight = "700";
    bold.textContent = "Bold";
    document.body.appendChild(bold);
    const header = document.getElementById("header")!;
    header.style.fontWeight = "600";

    const rules = variationRules(css);
    const code = document.getElementById("code")!;
    expect(Number.parseFloat(getComputedStyle(document.body).fontWeight)).toBe(430);
    expect(latinAxis(document.body, rules)).toBe(430);
    expect(Number.parseFloat(getComputedStyle(code).fontWeight)).toBe(400);
    expect(latinAxis(code, rules)).toBe(400);
    expect(latinAxis(bold, rules)).toBe(700);
    expect(latinAxis(header, rules)).toBe(600);
  });

  it("still flags a heavier element that an allowlist forgot", () => {
    const stylesheet = `
      html[data-os="mac"] body { font-weight: 400; font-variation-settings: "wght" 430; }
      .font-bold { font-variation-settings: normal; font-weight: 700; }
    `;
    document.documentElement.dataset.os = "mac";
    document.head.innerHTML = `<style>${stylesheet}</style>`;
    document.body.innerHTML = `<span class="font-bold" id="listed">Listed</span>`;
    const tag = `x-bold-${crypto.randomUUID().replaceAll("-", "")}`;
    const forgotten = document.createElement(tag);
    forgotten.style.fontWeight = "700";
    document.body.appendChild(forgotten);
    const rules = variationRules(stylesheet);
    expect(latinAxis(document.getElementById("listed")!, rules)).toBe(700);
    expect(latinAxis(forgotten, rules)).toBe(430);
  });
});
