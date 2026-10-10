/**
 * @vitest-environment happy-dom
 *
 * macOS resting text requests weight 400 so a missed PingFang local() name
 * stays Regular. Resting Latin is drawn at 430 by a per-element axis.
 * Heavier elements keep their own weight. happy-dom does not inherit
 * font-variation-settings, but Chromium does, so the stylesheet checks
 * below inherit declarations the way Chromium would. An element the
 * stylesheet has never named still has to draw Latin at its font-weight.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { installMacLatinAxis, macLatinVariation, syncMacLatinAxis } from "@/lib/mac-latin-axis";
import { matchFontWeight } from "@/lib/font-weight-match";

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
    expect(Number.parseFloat(getComputedStyle(document.body).fontWeight)).toBe(400);
    expect(latinAxis(bold, rules)).toBe(700);
    expect(latinAxis(header, rules)).toBe(600);
    expect(latinAxis(document.body, rules)).toBe(400);
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

  it("draws resting Latin at 430 while heavier weights keep their own", async () => {
    expect(macLatinVariation("400")).toBe('"wght" 430');
    expect(macLatinVariation("500")).toBe("normal");
    expect(macLatinVariation("600")).toBe("normal");
    expect(macLatinVariation("700")).toBe("normal");
    expect(macLatinVariation("normal")).toBe("normal");
    expect(macLatinVariation("")).toBe("normal");

    document.documentElement.dataset.os = "mac";
    document.head.innerHTML = `<style>
      ${css}
      .font-medium { font-weight: 500; }
      .font-semibold { font-weight: 600; }
      .font-bold { font-weight: 700; }
    </style>`;
    document.body.innerHTML = `
      <p id="rest">Hamburger 汉字</p>
      <span class="font-medium" id="medium">Medium</span>
      <span class="font-semibold" id="semibold">Semibold</span>
      <span class="font-bold" id="bold">Bold</span>
      <table><thead><tr><th id="header">Column</th></tr></thead></table>
    `;
    const tag = `x-bold-${crypto.randomUUID().replaceAll("-", "")}`;
    const arbitrary = document.createElement(tag);
    arbitrary.style.fontWeight = "700";
    document.body.appendChild(arbitrary);
    document.getElementById("header")!.style.fontWeight = "600";

    const stop = installMacLatinAxis(document);
    const axis = (id: string) => renderedLatinAxis(document.getElementById(id)!);
    expect(getComputedStyle(document.getElementById("rest")!).fontWeight).toBe("400");
    expect(axis("rest")).toBe(430);
    expect(axis("medium")).toBe(500);
    expect(axis("semibold")).toBe(600);
    expect(axis("bold")).toBe(700);
    expect(renderedLatinAxis(arbitrary)).toBe(700);
    expect(axis("header")).toBe(600);
    const pingfang = [100, 200, 300, 400, 500, 600].map((weight) => ({ min: weight, max: weight }));
    expect(matchFontWeight(400, pingfang)?.min).toBe(400);
    expect(matchFontWeight(430, pingfang)?.min).toBe(500);

    syncMacLatinAxis(document);
    expect(document.getElementById("rest")!.getAttribute("data-mac-latin")).toBe('"wght" 430');

    document.getElementById("rest")!.style.fontWeight = "700";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renderedLatinAxis(document.getElementById("rest")!)).toBe(700);

    const added = document.createElement("em");
    added.id = "added";
    added.textContent = "later";
    document.body.appendChild(added);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renderedLatinAxis(added)).toBe(430);
    added.style.fontWeight = "500";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(renderedLatinAxis(added)).toBe(500);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    syncMacLatinAxis(document);
    expect(svg.getAttribute("data-mac-latin")).toBeNull();

    const subtree = document.createElement("div");
    subtree.style.fontWeight = "600";
    const nested = document.createElement("span");
    nested.textContent = "nested";
    subtree.appendChild(nested);
    document.body.appendChild(subtree);
    syncMacLatinAxis(subtree);
    expect(renderedLatinAxis(subtree)).toBe(600);
    expect(renderedLatinAxis(nested)).toBe(600);

    stop();
    const ignored = document.createElement("strong");
    ignored.style.fontWeight = "700";
    document.body.appendChild(ignored);
    expect(ignored.getAttribute("data-mac-latin")).toBeNull();
  });

  it("does nothing unless the document is a macOS document that can be queried", () => {
    const linux = document.implementation.createHTMLDocument("linux");
    linux.documentElement.dataset.os = "linux";
    linux.body.textContent = "Rest";
    const stopLinux = installMacLatinAxis(linux);
    expect(linux.body.getAttribute("data-mac-latin")).toBeNull();
    stopLinux();

    const incomplete = { documentElement: { dataset: { os: "mac" } } } as unknown as Document;
    expect(installMacLatinAxis(incomplete)()).toBeUndefined();

    const noObserver = {
      documentElement: document.createElement("html"),
      querySelectorAll: () => [],
      defaultView: {},
    } as unknown as Document;
    noObserver.documentElement.dataset.os = "mac";
    expect(installMacLatinAxis(noObserver)()).toBeUndefined();

    const noRoot = { documentElement: null } as unknown as Document;
    expect(installMacLatinAxis(noRoot)()).toBeUndefined();
  });
});

function renderedLatinAxis(element: HTMLElement): number {
  const weight = Number.parseFloat(getComputedStyle(element).fontWeight);
  const variation = getComputedStyle(element).fontVariationSettings || element.style.fontVariationSettings;
  const pinned = /wght["']?\s+([0-9.]+)/i.exec(variation);
  return pinned ? Number(pinned[1]) : weight;
}
