import { describe, expect, it } from "vitest";

import {
  goalSessionStatePresentation,
  selectComposerSessionStatePresentation,
} from "./composer-session-state";

describe("composer session state selection", () => {
  it("selects a Plan Mode presentation for the shared slot without mutating Goal", () => {
    const goal = goalSessionStatePresentation(
      { objective: "Ship the feature", status: "active" },
      "Goal",
    );
    const plan = {
      id: "mode:codex-acp:plan",
      kind: "plan_mode",
      label: "Plan",
      title: "Plan mode is active",
      icon: "plan",
    } as const;

    expect(
      selectComposerSessionStatePresentation([
        { priority: 20, presentation: goal },
        { priority: 10, presentation: plan },
      ]),
    ).toBe(plan);
    expect(goal?.title).toBe("Ship the feature");
    expect(
      selectComposerSessionStatePresentation([
        { priority: 10, presentation: undefined },
        { priority: 20, presentation: goal },
      ]),
    ).toBe(goal);
  });
});

describe("session state exits", () => {
  it("declares Codex's goal cancel as its own control command", () => {
    // Plan resets a config option; a goal is cleared by the command Codex
    // publishes for it, so the two states cannot share one exit transport.
    const presentation = goalSessionStatePresentation(
      { objective: "ship the release", status: "active" },
      "Goal",
    );

    expect(presentation?.exit).toEqual({ kind: "prompt", text: "/goal clear" });
  });

  it("leaves a state without a declared exit undismissable", () => {
    expect(goalSessionStatePresentation(undefined, "Goal")).toBeUndefined();
  });
});
