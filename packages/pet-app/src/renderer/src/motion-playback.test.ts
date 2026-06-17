import { describe, expect, it } from "vitest";
import { shouldAnimateSprite, shouldAutoSettleMotion } from "./motion-playback";

describe("motion playback", () => {
  it("keeps idle alive with low-distraction animation", () => {
    expect(shouldAnimateSprite("idle")).toBe(true);
  });

  it("animates visible actions and drag running", () => {
    expect(shouldAnimateSprite("waving")).toBe(true);
    expect(shouldAnimateSprite("running-right")).toBe(true);
  });

  it("settles lightweight actions but keeps durable work states", () => {
    expect(shouldAutoSettleMotion("waving")).toBe(true);
    expect(shouldAutoSettleMotion("nudge")).toBe(true);
    expect(shouldAutoSettleMotion("tool-run")).toBe(false);
  });
});
