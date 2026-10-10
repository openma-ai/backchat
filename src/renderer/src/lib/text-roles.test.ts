import { describe, expect, it } from "vitest";

import {
  TEXT_ROLE_MIN_GAP,
  WCAG_AA_NORMAL_TEXT,
  contrastRatio,
  disabledForeground,
  mixSrgb,
} from "./text-roles";

describe("text role color math", () => {
  it("mixes sRGB channels and clamps the amount", () => {
    expect(mixSrgb("#000000", "#ffffff", 0)).toBe("#ffffff");
    expect(mixSrgb("#000000", "#ffffff", 1)).toBe("#000000");
    expect(mixSrgb("#000", "#fff", -1)).toBe("#ffffff");
    expect(mixSrgb("#000", "#fff", 2)).toBe("#000000");
    expect(mixSrgb("#abc", "#fff", 1)).toBe("#aabbcc");
  });

  it("mixes oklch colors, including channels outside 0..1", () => {
    expect(mixSrgb("oklch(0.2 0.02 30)", "oklch(0.95 0.01 250)", 0.4)).toMatch(/^#[0-9a-f]{6}$/);
    expect(mixSrgb("oklch(0.99 0.4 30)", "#000000", 1)).toMatch(/^#[0-9a-f]{6}$/);
    expect(mixSrgb("#010101", "#000000", 0.02)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("uses both halves of the sRGB transfer curve", () => {
    expect(contrastRatio("#050505", "#ffffff")).toBeGreaterThan(1);
    expect(contrastRatio("#808080", "#ffffff")).toBeGreaterThan(1);
    expect(contrastRatio("#000000", "#010101")).toBeGreaterThan(1);
  });

  it("rejects a color the renderer does not store", () => {
    expect(() => contrastRatio("red", "#ffffff")).toThrow(/Unsupported color token/);
    expect(() => mixSrgb("red", "#ffffff", 1)).toThrow(/Unsupported color token/);
  });

  it("derives a disabled color that still clears AA", () => {
    const color = disabledForeground("#141414", "#fcfcfc", ["#fcfcfc", "#f3f3f3"]);
    expect(contrastRatio(color, "#f3f3f3")).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio("#141414", "#fcfcfc")).toBeGreaterThan(
      contrastRatio(color, "#fcfcfc") + TEXT_ROLE_MIN_GAP,
    );
  });

  it("walks the mix upward when rounding drops the binary-search color under AA", () => {
    const color = disabledForeground("#767676", "#ffffff", ["#ffffff"]);
    expect(contrastRatio(color, "#ffffff")).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it("returns the strongest mix when no amount clears AA", () => {
    const color = disabledForeground("#888888", "#808080", ["#ffffff"]);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(color, "#ffffff")).toBeLessThan(WCAG_AA_NORMAL_TEXT);
  });
});
