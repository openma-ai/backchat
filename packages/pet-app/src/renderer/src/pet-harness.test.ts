import { describe, expect, it } from "vitest";
import { createPetHarnessRegistry } from "./pet-harness";
import type { PetAction } from "@open-managed-agents-desktop/pet-runtime";

describe("pet harness registry", () => {
  it("normalizes Codex hooks into generic pet signals", () => {
    const registry = createPetHarnessRegistry();

    expect(
      registry.normalize({
        harness: "codex",
        event: "approval.requested",
        threadId: "thread-1",
        turnId: "turn-1",
        label: "Approve command",
      }),
    ).toEqual([
      {
        id: "codex:thread-1:turn-1:approval.requested",
        source: "codex",
        name: "permission.requested",
        sessionId: "thread-1",
        turnId: "turn-1",
        labels: { title: "Approve command", harness: "codex", threadId: "thread-1" },
        payload: {
          harness: "codex",
          event: "approval.requested",
          threadId: "thread-1",
          turnId: "turn-1",
          label: "Approve command",
        },
      },
    ]);
  });

  it("creates harness-specific session navigation URLs from runtime actions", () => {
    const registry = createPetHarnessRegistry();
    const codexAction: PetAction = {
      type: "motion",
      motion: "ask",
      intensity: "high",
      priority: "urgent",
      source: "codex",
      sessionId: "thread/with space",
    };
    const backchatAction: PetAction = {
      type: "motion",
      motion: "ask",
      intensity: "high",
      priority: "urgent",
      source: "backchat.session",
      sessionId: "sess/with space",
    };

    expect(registry.navigationUrlForAction(codexAction)).toBe("codex://threads/thread%2Fwith%20space");
    expect(registry.navigationUrlForAction(backchatAction)).toBe("backchat://sessions/sess%2Fwith%20space");
  });
});
