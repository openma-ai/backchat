import { describe, expect, it } from "vitest";
import {
  edgeInteractionClass,
  edgeIntensityForInteraction,
  nextEdgeInteraction,
  shouldAutoSettleEdgeInteraction,
} from "./edge-interaction";

describe("edge interaction model", () => {
  it("keeps edge idle quiet", () => {
    expect(edgeIntensityForInteraction("idle")).toBe("quiet");
  });

  it("uses stronger transient states for hover and click", () => {
    expect(edgeIntensityForInteraction("hover")).toBe("normal");
    expect(edgeIntensityForInteraction("click")).toBe("attention");
  });

  it("settles transient edge interactions back to idle", () => {
    expect(nextEdgeInteraction("hover", "settle")).toBe("idle");
    expect(nextEdgeInteraction("click", "settle")).toBe("idle");
  });

  it("does not let hover downgrade an active click reaction", () => {
    expect(nextEdgeInteraction("click", "hover")).toBe("click");
  });

  it("keeps hover alive until pointer leave but auto-settles click", () => {
    expect(shouldAutoSettleEdgeInteraction("hover")).toBe(false);
    expect(shouldAutoSettleEdgeInteraction("click")).toBe(true);
  });

  it("uses dedicated half-attached animation classes", () => {
    expect(edgeInteractionClass("idle")).toBe("edge-interaction-idle");
    expect(edgeInteractionClass("hover")).toBe("edge-interaction-hover");
    expect(edgeInteractionClass("click")).toBe("edge-interaction-click");
  });
});
