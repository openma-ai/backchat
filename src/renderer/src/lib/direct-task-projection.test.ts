import { it, expect } from "vitest";
import { createOpenMAEvent } from "@openma/common/session-events/openma";
import { projectOpenmaTask } from "./openma-task-projection";
import type { OpenmaTaskSnapshot } from "@shared/openma";
it("renders direct providers using canonical turns, replacing streamed text and preserving failure", () => {
  const event = (id: string, type: string, data: unknown) => ({ id, type, canonical: createOpenMAEvent({ event_id: id, type, session_id: "s", turn_id: "t", source: { kind: "harness" }, occurred_at: "2026-09-17T00:00:00Z", data }) });
  const snapshot: OpenmaTaskSnapshot = {
    task: { id: "task", sessionId: "s", provider: "openai-agents", baseUrl: "https://test", userId: "u", workspaceId: "w", title: "Test", status: "idle", createdAt: 1, updatedAt: 2, afterSeq: 0,
      target: { kind: "cloud", agentId: "a", agentName: "Agent", environmentId: "none", environmentName: "None", runtimeId: null, runtimeName: "Cloud", baseUrl: "https://test", userId: "u", workspaceId: "w" } },
    connection: "online", operations: [], events: [event("u", "user.message", { message_id: "u", text: "Hello" }), event("c", "agent.message_chunk", { message_id: "m", text: "Hi" }), event("v", "vendor.event", { kind: "vendor", harness: "openai-agents", namespace: "agents", name: "agent.session.turn.content_part.done", data: {} }), event("m", "agent.message", { message_id: "m", text: "Hi there" }), event("f", "turn.failed", { message: "Failed" })],
  };
  const { turns } = projectOpenmaTask(snapshot);
  expect(turns).toHaveLength(1);
  expect(turns[0]).toMatchObject({ promptText: "Hello", assistantText: "Hi there", status: "error", errorMessage: "Failed" });
});
