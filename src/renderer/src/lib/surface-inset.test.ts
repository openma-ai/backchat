/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(__dirname, "../styles/index.css"), "utf8");

function rule(selector: string): string {
  const start = styles.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = styles.indexOf("{", start);
  const close = styles.indexOf("}", open);
  return styles.slice(start, close + 1);
}

describe("nested surface contrast", () => {
  it("steps descendant surface aliases off the panel fill", () => {
    document.head.innerHTML = `<style>
      :root {
        --bg: #fcfcfc;
        --bg-surface: #f3f3f3;
        --bg-bubble: #e9e9e9;
        --surface-panel: var(--bg-surface);
        --surface-inset: var(--bg-bubble);
        --surface-field: var(--surface-inset);
        --color-bg-surface: var(--bg-surface);
        --color-secondary: var(--bg-surface);
      }
      ${rule(".app-panel-surface,\n.app-rail-surface,\n.app-composer-surface {")}
      ${rule(".app-composer-surface * {")}
      ${rule(".app-composer-surface:not(.composer-card) :is(")}
      .bg-bg-surface\\/45 { background-color: color-mix(in oklab, var(--color-bg-surface) 45%, transparent); }
      .bg-bg-surface { background-color: var(--color-bg-surface); }
      .bg-secondary { background-color: var(--color-secondary); }
      .bg-transparent { background-color: transparent; }
    </style>`;
    document.body.innerHTML = `
      <section class="app-composer-surface" id="card">
        <span class="bg-bg-surface" id="chip"></span>
        <div class="bg-bg-surface/45" id="track">
          <span class="bg-bg-surface" id="selected"></span>
        </div>
        <span class="bg-secondary" id="badge"></span>
        <input id="field" class="bg-transparent" />
        <input id="check" type="checkbox" />
      </section>
      <section class="app-composer-surface composer-card" id="composer">
        <textarea id="body" class="bg-transparent"></textarea>
      </section>
      <span class="bg-bg-surface" id="outside"></span>
    `;

    const color = (id: string) => getComputedStyle(document.getElementById(id)!).backgroundColor;
    const card = color("card");
    const chip = color("chip");
    const badge = color("badge");
    const outside = color("outside");

    const clear = (value: string) => value === "transparent" || value === "rgba(0, 0, 0, 0)";
    expect(clear(chip)).toBe(false);
    expect(card).not.toBe(chip);
    expect(card).not.toBe(badge);
    expect(chip).toBe(badge);
    expect(outside).toBe(card);
    expect(color("selected")).not.toBe(color("track"));
    expect(clear(color("body"))).toBe(true);
    // The field rule uses :is()/:not() selector lists. happy-dom does not
    // apply that selector; Chromium does, and the source contract below is
    // what CI enforces. Electron was checked separately for the fill.
    expect(styles).toContain("background-color: var(--surface-field);");
    expect(styles).toContain(".app-composer-surface:not(.composer-card) :is(");
    expect(styles).toContain('[type="checkbox"]');
  });
});
