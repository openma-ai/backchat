import { describe, expect, it } from "vitest";
import {
  ATLAS_CELL_SIZE,
  BOTTOM_REST_SCREEN_EDGE_OVERHANG,
  BOTTOM_REST_SIZE,
  BOTTOM_SCREEN_WINDOW_SIZE,
  NORMAL_WINDOW_SIZE,
  SIDE_PEEK_SIZE,
  TOP_PEEK_SIZE,
  atlasOffsetForWindow,
  centeredInset,
} from "./pet-size-model";

describe("pet size model", () => {
  it("keeps the atlas cell separate from the OS window", () => {
    expect(ATLAS_CELL_SIZE).toEqual({ width: 96, height: 104 });
    expect(NORMAL_WINDOW_SIZE.width).toBeGreaterThan(ATLAS_CELL_SIZE.width);
    expect(NORMAL_WINDOW_SIZE.height).toBeGreaterThan(ATLAS_CELL_SIZE.height);
  });

  it("derives edge windows as smaller presentations, never larger cards", () => {
    for (const size of [SIDE_PEEK_SIZE, TOP_PEEK_SIZE, BOTTOM_REST_SIZE]) {
      expect(size.width).toBeLessThanOrEqual(NORMAL_WINDOW_SIZE.width);
      expect(size.height).toBeLessThanOrEqual(NORMAL_WINDOW_SIZE.height);
    }
  });

  it("keeps the bottom rest compact enough to read as a ledge pose", () => {
    expect(BOTTOM_REST_SIZE).toEqual({ width: 112, height: 72 });
    expect(BOTTOM_SCREEN_WINDOW_SIZE).toEqual(NORMAL_WINDOW_SIZE);
    expect(BOTTOM_REST_SCREEN_EDGE_OVERHANG).toBe(8);
  });

  it("computes atlas offsets from the normal-window baseline", () => {
    expect(centeredInset(NORMAL_WINDOW_SIZE, ATLAS_CELL_SIZE)).toEqual({ x: 8, y: 12 });
    expect(atlasOffsetForWindow(BOTTOM_REST_SIZE)).toEqual({ x: 0, y: 28 });
  });
});
