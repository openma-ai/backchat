import { describe, expect, it } from "vitest";
import { createPetHarnessRegistry } from "./pet-harness";
import type { PetAction } from "@open-managed-agents-desktop/pet-runtime";

describe("pet harness registry", () => {
  it("normalizes Codex hooks into generic pet signals", () => {
    const registry = createPetHarnessRegistry();
    const threadId = "019ecf32-f48f-7371-96f9-c6802555aeea";

    expect(
      registry.normalize({
        harness: "codex",
        event: "approval.requested",
        threadId,
        turnId: "turn-1",
        label: "Approve command",
      }),
    ).toEqual([
      expect.objectContaining({
        id: `codex:${threadId}:turn-1:approval.requested`,
        source: "codex",
        name: "permission.requested",
        sessionId: threadId,
        turnId: "turn-1",
        labels: { title: "Approve command", harness: "codex", threadId },
      }),
    ]);
  });

  it("creates harness-specific session navigation URLs from runtime actions", () => {
    const registry = createPetHarnessRegistry();
    const threadId = "019ecf32-f48f-7371-96f9-c6802555aeea";
    const codexAction: PetAction = {
      type: "motion",
      motion: "ask",
      intensity: "high",
      priority: "urgent",
      source: "codex",
      sessionId: `codex:${threadId}`,
    };
    const backchatAction: PetAction = {
      type: "motion",
      motion: "ask",
      intensity: "high",
      priority: "urgent",
      source: "backchat.session",
      sessionId: "sess/with space",
    };

    expect(registry.navigationUrlForAction(codexAction)).toBe(`codex://threads/${threadId}`);
    expect(registry.navigationUrlForAction(backchatAction)).toBe("backchat://sessions/sess%2Fwith%20space");
  });

  it("normalizes official Codex hook payloads from transcript paths", () => {
    const registry = createPetHarnessRegistry();
    const threadId = "019ecf32-f48f-7371-96f9-c6802555aeea";

    expect(
      registry.normalize({
        harness: "codex",
        event: "Stop",
        payload: {
          transcript_path: `/Users/minimax/.codex/sessions/2026/06/18/${threadId}.jsonl`,
          summary: "Find hatch pet skills",
        },
      }).at(-1),
    ).toMatchObject({
      id: `codex:${threadId}:Stop`,
      source: "codex",
      name: "session.completed",
      sessionId: threadId,
      labels: { title: "Find hatch pet skills", harness: "codex", threadId },
    });

    expect(
      registry.normalize({
        harness: "codex",
        event: "PermissionRequest",
        payload: {
          thread_id: threadId,
          turn_id: "turn-2",
          message: "Approve shell command",
        },
      }).at(-1),
    ).toMatchObject({
      id: `codex:${threadId}:turn-2:PermissionRequest`,
      name: "permission.requested",
      sessionId: threadId,
      turnId: "turn-2",
      labels: { title: "Approve shell command", harness: "codex", threadId },
    });
  });

  it("does not make Codex deeplinks for non-thread ids", () => {
    const registry = createPetHarnessRegistry();

    expect(registry.navigationUrlForAction({
      type: "motion",
      motion: "ask",
      intensity: "high",
      priority: "urgent",
      source: "codex",
      sessionId: "not-a-thread-id",
    })).toBeUndefined();
  });
});
