import { describe, expect, it } from "vitest";
import { inferDockBoundsForDisplayWithPreferences, parseAccessibleDockBounds } from "./dock-geometry";

const display = {
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 33, width: 1512, height: 883 },
};
const displayWithoutBottomReserve = {
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 33, width: 1512, height: 949 },
};

describe("dock geometry", () => {
  it("parses the accessible Dock AXList bounds", () => {
    expect(parseAccessibleDockBounds("AXList, 275, 912, 962, 60, missing value", display)).toEqual({
      x: 275,
      y: 916,
      width: 962,
      height: 66,
    });
  });

  it("keeps the accessible Dock x range when the AXList y is reported at the screen edge", () => {
    expect(parseAccessibleDockBounds("AXList, 275, 982, 962, 60, missing value", display)).toEqual({
      x: 275,
      y: 916,
      width: 962,
      height: 66,
    });
  });

  it("uses the AXList bottom position when the display has no bottom Dock reserve", () => {
    expect(parseAccessibleDockBounds("AXList, 275, 982, 962, 60, missing value", displayWithoutBottomReserve)).toEqual({
      x: 275,
      y: 922,
      width: 962,
      height: 60,
    });
  });

  it("ignores accessible Dock bounds from another display", () => {
    expect(parseAccessibleDockBounds("AXList, 1900, 912, 962, 60, missing value", display)).toBeUndefined();
  });

  it("can infer a start-pinned bottom Dock range", () => {
    expect(
      inferDockBoundsForDisplayWithPreferences(display, {
        iconCount: 10,
        pinning: "start",
        tileSize: 46,
      }),
    ).toEqual({ x: 0, y: 916, width: 556, height: 66 });
  });

  it("can infer a middle-pinned bottom Dock range when explicitly configured", () => {
    expect(
      inferDockBoundsForDisplayWithPreferences(display, {
        iconCount: 10,
        pinning: "middle",
        tileSize: 46,
      }),
    ).toEqual({ x: 478, y: 916, width: 556, height: 66 });
  });
});
