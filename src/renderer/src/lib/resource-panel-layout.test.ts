import { expect, it } from "vitest";
import { resourcePanelFitsGutter } from "./resource-panel-layout";
it("uses an overlay when the right gutter cannot fit the panel", () => {
  expect(resourcePanelFitsGutter(1600, 1400, 1)).toBe(false);
});
it("docks only inside existing whitespace including its gap", () => {
  expect(resourcePanelFitsGutter(2000, 1688, 1)).toBe(true);
  expect(resourcePanelFitsGutter(2000, 1689, 1)).toBe(false);
});
it("accounts for UI zoom when comparing physical rectangles", () => {
  expect(resourcePanelFitsGutter(2000, 1650, 1.25)).toBe(false);
  expect(resourcePanelFitsGutter(2000, 1610, 1.25)).toBe(true);
});
