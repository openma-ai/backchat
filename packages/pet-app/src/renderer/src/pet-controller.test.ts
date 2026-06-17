import { describe, expect, it } from "vitest";
import { createStandalonePetController, petActionToViewState } from "./pet-controller";
import { createPetHarnessRegistry } from "./pet-harness";

describe("standalone pet controller", () => {
  it("creates pet-life proactive states without a Backchat dependency", () => {
    const controller = createStandalonePetController({ now: () => 1_000 });

    expect(controller.idleTick("idle-1")).toEqual([
      expect.objectContaining({
        motion: "nudge",
        mood: "awake",
        label: "still here",
        proactive: true,
      }),
    ]);
  });

  it("can target Backchat sessions through optional sidecar navigation", () => {
    expect(
      petActionToViewState({
        type: "motion",
        motion: "ask",
        intensity: "high",
        priority: "urgent",
        reason: "requestPermission",
        sessionId: "sess-1",
        label: "Approve edit",
      }),
    ).toMatchObject({
      motion: "ask",
      mood: "asking",
      navigationUrl: "backchat://sessions/sess-1",
    });
  });

  it("maps common standalone sidecar events to atlas-backed states", () => {
    const controller = createStandalonePetController({ now: () => 1_000 });

    expect(controller.dispatchEvent("pet.clicked").at(-1)).toMatchObject({
      motion: "idle",
      mood: "calm",
      label: "hi",
    });
    expect(controller.dispatchEvent("pet.hovered").at(-1)).toMatchObject({
      motion: "waving",
      mood: "awake",
      label: "hi",
    });
    expect(controller.dispatchEvent("session.failed", { label: "Build failed" }).at(-1)).toMatchObject({
      motion: "warn",
      mood: "worried",
      label: "Build failed",
    });
    expect(controller.dispatchEvent("tool.run", { label: "Running tests" }).at(-1))
      .toMatchObject({
        motion: "tool-run",
        mood: "focused",
        label: "Running tests",
      });
    expect(controller.dispatchEvent("permission.requested", {
      label: "Approve edit",
      sessionId: "sess-1",
    }).at(-1)).toMatchObject({
      motion: "ask",
      mood: "asking",
      navigationUrl: "backchat://sessions/sess-1",
    });
    expect(controller.dispatchEvent("tests.passed").at(-1)).toMatchObject({
      motion: "celebrate",
      mood: "proud",
    });
  });

  it("uses harness adapters for Codex hooks and deeplinks", () => {
    const controller = createStandalonePetController({
      now: () => 1_000,
      harnessRegistry: createPetHarnessRegistry(),
    });
    const threadId = "019ecf32-f48f-7371-96f9-c6802555aeea";

    expect(
      controller.dispatchHarnessEvent({
        harness: "codex",
        event: "approval.requested",
        threadId,
        label: "Approve shell command",
      }).at(-1),
    ).toMatchObject({
      motion: "ask",
      mood: "asking",
      label: "Approve shell command",
      sessionId: threadId,
      navigationUrl: `codex://threads/${threadId}`,
    });

    expect(
      controller.dispatchHarnessEvent({
        harness: "codex",
        event: "task.completed",
        threadId,
      }).at(-1),
    ).toMatchObject({
      motion: "celebrate",
      mood: "proud",
      navigationUrl: `codex://threads/${threadId}`,
    });
  });
});
