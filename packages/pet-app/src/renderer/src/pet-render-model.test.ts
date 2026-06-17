import { describe, expect, it } from "vitest";
import { visualLayerForEdgeMode } from "./pet-render-model";

describe("pet render model", () => {
  it("uses the generated bottom rest strip for bottom rests", () => {
    expect(visualLayerForEdgeMode("bottom")).toBe("bottom-rest-strip");
  });

  it("uses generated strip only for side peeking", () => {
    expect(visualLayerForEdgeMode("left")).toBe("side-peek-strip");
    expect(visualLayerForEdgeMode("right")).toBe("side-peek-strip");
    expect(visualLayerForEdgeMode("none")).toBe("atlas");
  });
});
