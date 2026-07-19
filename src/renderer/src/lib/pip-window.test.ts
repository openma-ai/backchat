import { describe, expect, it } from "vitest";
import {
  constrainPipRect,
  createInitialPipRect,
  movePipRect,
  resizePipRect,
  type PipRect,
} from "./pip-window.js";

const viewport = { width: 1200, height: 800 };

describe("PIP window geometry", () => {
  it("opens at a native-window size in the lower-right safe area", () => {
    expect(createInitialPipRect(viewport)).toEqual({
      x: 704,
      y: 424,
      width: 480,
      height: 360,
    });
  });

  it("keeps a moved window inside the viewport safe area", () => {
    const rect: PipRect = { x: 704, y: 424, width: 480, height: 360 };

    expect(movePipRect(rect, -1000, -1000, viewport)).toEqual({
      x: 16,
      y: 16,
      width: 480,
      height: 360,
    });
    expect(movePipRect(rect, 1000, 1000, viewport)).toEqual(rect);
  });

  it("resizes from an edge while preserving the opposite edge", () => {
    const rect: PipRect = { x: 704, y: 424, width: 480, height: 360 };

    expect(resizePipRect(rect, "west", -80, 0, viewport)).toEqual({
      x: 624,
      y: 424,
      width: 560,
      height: 360,
    });
    expect(resizePipRect(rect, "north-west", 80, 100, viewport)).toEqual({
      x: 784,
      y: 524,
      width: 400,
      height: 260,
    });
  });

  it("enforces the minimum size and reclamps after viewport changes", () => {
    const rect: PipRect = { x: 704, y: 424, width: 480, height: 360 };

    expect(resizePipRect(rect, "south-east", -400, -400, viewport)).toEqual({
      x: 704,
      y: 424,
      width: 320,
      height: 220,
    });
    expect(constrainPipRect(rect, { width: 740, height: 500 })).toEqual({
      x: 244,
      y: 124,
      width: 480,
      height: 360,
    });
  });
});
