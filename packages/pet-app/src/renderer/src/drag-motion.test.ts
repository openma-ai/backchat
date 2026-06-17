import { describe, expect, it } from "vitest";
import { dragMotionForDelta } from "./drag-motion";

describe("dragMotionForDelta", () => {
  it("uses right and left running animations while the pet is being dragged", () => {
    expect(dragMotionForDelta(6)).toBe("running-right");
    expect(dragMotionForDelta(-6)).toBe("running-left");
  });

  it("does not switch animation for tiny pointer jitter", () => {
    expect(dragMotionForDelta(3)).toBeNull();
    expect(dragMotionForDelta(-3)).toBeNull();
  });
});
