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

it("keeps a Cursor Cloud follow-up in the desktop queue and does not offer steering", () => {
  const snapshot: OpenmaTaskSnapshot = {
    task: { id: "task", sessionId: "s", provider: "cursor-cloud", baseUrl: "https://api.cursor.com", userId: "u", workspaceId: "w", title: "Cloud", status: "running", createdAt: 1, updatedAt: 2, afterSeq: 0,
      target: { kind: "cloud", agentId: "default", agentName: "Default", environmentId: "cloud", environmentName: "Cursor Cloud", runtimeId: null, runtimeName: "Cloud", baseUrl: "https://api.cursor.com", userId: "u", workspaceId: "w" } },
    connection: "online",
    operations: [{ id: "op", state: "pending", createdAt: 5, event: { type: "user.message", content: [{ type: "text", text: "next" }] } }],
    events: [],
  };
  const { row, turns } = projectOpenmaTask(snapshot);
  expect(row.supportsSteering).toBe(false);
  expect(row.queuedPrompts).toEqual([{ turn_id: "op", text: "next", created_at: 5 }]);
  expect(turns.map((turn) => turn.status)).toEqual(["queued"]);
});
