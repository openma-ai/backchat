import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPOSER_BOX_CLASS,
  COMPOSER_FRAME_CLASS,
  composerBoxClass,
} from "./composer-box";

describe("composer box", () => {
  it("points settings panels at the composer classes", () => {
    expect(COMPOSER_BOX_CLASS).toBe("app-composer-surface composer-radius");
    expect(COMPOSER_FRAME_CLASS).toBe("composer-box-border composer-radius");
    expect(composerBoxClass()).toBe(COMPOSER_BOX_CLASS);
    expect(composerBoxClass({ frame: false })).toBe(COMPOSER_BOX_CLASS);
    expect(composerBoxClass({ className: "overflow-hidden" })).toBe(
      `${COMPOSER_BOX_CLASS} overflow-hidden`,
    );
    expect(composerBoxClass({ frame: true })).toBe(COMPOSER_FRAME_CLASS);
    expect(composerBoxClass({ frame: true, className: "h-28" })).toBe(
      `${COMPOSER_FRAME_CLASS} h-28`,
    );
  });

  it("declares the frame border in the same rule as the composer", () => {
    const styles = readFileSync(
      resolve(__dirname, "../styles/index.css"),
      "utf8",
    );
    expect(styles).toMatch(
      /\.app-composer-surface,\s*\.composer-box-border\s*\{[^}]*border:\s*var\(--composer-card-border-width\)\s+solid\s+var\(--border\);/,
    );
    expect(styles).toMatch(/\.composer-radius\s*\{[^}]*border-radius:\s*var\(--composer-radius\);/);
    expect(styles).toMatch(
      /\.app-panel-surface,\s*\.app-rail-surface,\s*\.app-composer-surface\s*\{[^}]*background:\s*var\(--surface-panel\);/,
    );
    expect(styles).toContain("--surface-inset: var(--bg-bubble);");
    expect(styles).toMatch(
      /\.app-composer-surface \* \{[^}]*--color-bg-surface:\s*var\(--surface-inset\);/,
    );
    expect(styles).toMatch(
      /\.app-composer-surface \* \{[^}]*--color-secondary:\s*var\(--surface-inset\);/,
    );
    expect(styles).toContain(
      ".app-composer-surface:not(.composer-card) :is(",
    );
    expect(styles).toContain("background-color: var(--surface-field);");

    const composer = readFileSync(
      resolve(__dirname, "../components/chat/ComposerPrimitives.tsx"),
      "utf8",
    );
    const notice = readFileSync(
      resolve(__dirname, "../components/chat/ComposerNotice.tsx"),
      "utf8",
    );
    const card = readFileSync(
      resolve(__dirname, "../pages/settings/SettingsPrimitives.tsx"),
      "utf8",
    );
    expect(composer).toContain("COMPOSER_BOX_CLASS");
    expect(notice).toContain("COMPOSER_BOX_CLASS");
    expect(card).toContain("composerBoxClass(");
  });
});
