import { describe, expect, it } from "vitest";
import {
  atlasRowForMotion,
  intensityForState,
  presentationForState,
  runningFallbackAfterTransient,
} from "./pet-presentation";
import type { PetViewState } from "./pet-controller";

const baseState: PetViewState = {
  motion: "idle",
  mood: "calm",
  intensity: "low",
  priority: "low",
  label: "Mote",
  proactive: false,
  updatedAt: 1,
};

describe("pet presentation", () => {
  it("keeps the official hatch-pet atlas as the rendering contract", () => {
    expect(atlasRowForMotion("idle")).toBe("idle");
    expect(atlasRowForMotion("running-right")).toBe("running-right");
    expect(atlasRowForMotion("running-left")).toBe("running-left");
    expect(atlasRowForMotion("nudge")).toBe("waving");
    expect(atlasRowForMotion("celebrate")).toBe("jumping");
    expect(atlasRowForMotion("warn")).toBe("failed");
    expect(atlasRowForMotion("ask")).toBe("waiting");
    expect(atlasRowForMotion("tool-run")).toBe("running");
    expect(atlasRowForMotion("review")).toBe("review");
  });

  it("separates interaction intensity from atlas row selection", () => {
    expect(intensityForState(baseState)).toBe("quiet");
    expect(intensityForState({ ...baseState, motion: "nudge", mood: "awake", priority: "low" })).toBe("quiet");
    expect(intensityForState({ ...baseState, motion: "ask", mood: "asking", priority: "urgent" })).toBe("attention");
  });

  it("lets drag motion override semantic state without changing the state object", () => {
    expect(presentationForState({ ...baseState, motion: "tool-run", priority: "normal" }, "running-left"))
      .toMatchObject({
        rowState: "running-left",
        row: 2,
        frames: 8,
      });
  });

  it("plays one running pass after hover when work was active", () => {
    expect(
      runningFallbackAfterTransient(
        { ...baseState, motion: "waving", mood: "awake", label: "hi" },
        { ...baseState, motion: "tool-run", mood: "focused", priority: "normal", label: "Running tests" },
        10,
      ),
    ).toMatchObject({
      motion: "running",
      mood: "focused",
      label: "Running tests",
      updatedAt: 10,
    });

    expect(
      runningFallbackAfterTransient(
        { ...baseState, motion: "waving", mood: "awake", label: "hi" },
        { ...baseState, motion: "ask", mood: "asking", priority: "urgent", label: "Approve edit" },
        10,
      ),
    ).toBeNull();
  });
});
