import { describe, expect, it } from "vitest";
import type { OpenmaTaskSnapshot } from "@shared/openma";
import { projectOpenmaTask } from "./openma-task-projection";
import { reduceTurn } from "./reduce-turn";
import { SessionStore } from "./session-store";

const snapshot: OpenmaTaskSnapshot = {
  task: { id: "desktop", sessionId: "remote", baseUrl: "https://example.com", userId: "user", workspaceId: "team", title: "Remote task", status: "running", createdAt: 1, updatedAt: 2, afterSeq: 2,
    target: { baseUrl: "https://example.com", userId: "user", workspaceId: "team", kind: "cloud", agentId: "a", agentName: "Cloud agent", environmentId: "e", environmentName: "Project", runtimeId: null, runtimeName: "Cloud" } },
  connection: "offline", operations: [], events: [
    { id: "user", seq: 1, type: "user.message", content: [{ type: "text", text: "Run tests" }], metadata: { "backchat.operation_id": "op" } },
    { id: "running", seq: 2, type: "session.status_running" },
    { type: "agent.message_chunk", message_id: "message", delta: "Checking" },
  ],
};
describe("OpenMA task projection", () => {
  it("restores a runner permission using the original callback choices", () => {
    const options = [{ optionId: "write:once", name: "Write once", kind: "allow_once" }, { optionId: "write:never", name: "Reject write", kind: "reject_once" }];
    const result = projectOpenmaTask({ ...snapshot, events: [...snapshot.events,
      { type: "agent.custom_tool_use", id: "permission", name: "Write a file", input: { _openma: { type: "runtime_action", method: "session/request_permission", turn_id: "native-turn", params: { toolCall: { toolCallId: "write", title: "Write a file", kind: "edit" }, options } } } },
      { type: "session.status_idle", stop_reason: { type: "requires_action", action_type: "custom_tool_result", event_ids: ["permission"] } },
    ] });
    expect(result.row.pendingAsks).toEqual([{ kind: "permission", openmaResponse: "runtime_permission", ask: {
      requestId: "permission", sessionId: "desktop", toolCall: { toolCallId: "write", title: "Write a file", kind: "edit" },
      presentation: { title: "Write a file", kind: "edit" }, options,
    } }]);
  });

  it("preserves paragraph boundaries between messages while joining chunks within a message", () => {
    const result = projectOpenmaTask({ ...snapshot, events: [...snapshot.events.slice(0, 2),
      { type: "agent.message", id: "a", message_id: "first", content: [{ type: "text", text: "First answer." }] },
      { type: "agent.message_chunk", message_id: "second", delta: "Second" },
      { type: "agent.message_chunk", message_id: "second", delta: " answer." },
    ] });
    expect(result.turns[0]?.assistantText).toBe("First answer.\n\nSecond answer.");
    expect(result.turns[0]?.events.map((e) => (e.payload as { text: string }).text).join("")).toBe("First answer.\n\nSecond answer.");
  });

  it("isolates workspace tasks, pins execution targets, and corrects an existing live stream", () => {
    const store = new SessionStore();
    const draft = store.newDraft();
    store.setExecutionTarget(draft, snapshot.task.target);
    expect(store.get(draft)?.executionTarget).toEqual(snapshot.task.target);
    store.applyOpenmaSnapshot(snapshot);
    expect(() => store.setExecutionTarget(snapshot.task.id, undefined)).toThrow(/fixed/i);
    const revision = store.turnsFor(snapshot.task.id)[0]?.streamRevision ?? 0;
    store.applyOpenmaSnapshot({ ...snapshot, events: [...snapshot.events.slice(0, 2), { type: "agent.message_chunk", message_id: "message", delta: "Corrected" }] });
    expect(store.turnsFor(snapshot.task.id)[0]?.streamRevision).toBe(revision + 1);
    store.clearOpenmaTasks();
    expect(store.get(snapshot.task.id)).toBeUndefined();
    expect(store.get(draft)).toBeUndefined();
  });
  it("preserves running state on disconnection and replaces a streamed message with its committed text", () => {
    const first = projectOpenmaTask(snapshot);
    expect(first.row).toMatchObject({ cwd: "", acp_session_id: "", status: "running", remoteConnection: "offline" });
    expect(first.turns).toHaveLength(1);
    expect(first.turns[0]).toMatchObject({ id: "desktop:op", promptText: "Run tests", assistantText: "Checking", status: "running" });
    const complete = projectOpenmaTask({ ...snapshot, task: { ...snapshot.task, status: "idle" }, events: [...snapshot.events,
      { type: "agent.message", id: "committed", seq: 3, message_id: "message", content: [{ type: "text", text: "All tests passed" }] },
      { type: "session.status_idle", id: "idle", seq: 4, stop_reason: { type: "end_turn" } },
    ] });
    expect(complete.turns[0]).toMatchObject({ id: first.turns[0]!.id, assistantText: "All tests passed", status: "complete" });
  });
  it("renders remote tool activity with existing components and keeps uncertain input separate", () => {
    const result = projectOpenmaTask({ ...snapshot, events: [...snapshot.events,
      { id: "tool", seq: 3, type: "agent.tool_use", name: "bash", input: { command: "pnpm test" } },
      { id: "result", seq: 4, type: "agent.tool_result", tool_use_id: "tool", content: [{ type: "text", text: "12 passed" }] },
    ], operations: [{ id: "pending", state: "uncertain", createdAt: 5, event: { type: "user.message", content: [{ type: "text", text: "Next step" }] } }] });
    expect(reduceTurn(result.turns[0]!.events).tools).toMatchObject([{ toolCallId: "tool", title: "bash", status: "completed" }]);
    expect(result.turns[1]).toMatchObject({ id: "desktop:pending", promptText: "Next step", status: "unknown" });
    expect(result.row.status).toBe("running");
  });
});

it("shows an exhausted cloud execution error instead of a blank completed reply", () => {
  const events = [...snapshot.events,
    { type: "session.error", error: { type: "unknown_error", message: "Node ACP sandbox requires the pinned Session agent (child ACP capabilities are not supported)", retry_status: { type: "exhausted" } } },
    { type: "session.status_idle", stop_reason: { type: "retries_exhausted" } },
  ];
  const result = projectOpenmaTask({ ...snapshot, task: { ...snapshot.task, status: "idle" }, events });
  expect(result.turns[0]).toMatchObject({ status: "error", errorMessage: "Node ACP sandbox requires the pinned Session agent (child ACP capabilities are not supported)", stopReason: "retries_exhausted", assistantText: "Checking" });
  expect(result.row.activeTurnId).toBeUndefined();
  const store = new SessionStore();
  store.applyOpenmaSnapshot({ ...snapshot, task: { ...snapshot.task, status: "idle" }, events });
  expect(store.turnsFor("desktop")[0]).toMatchObject({ status: "error", errorMessage: result.turns[0]!.errorMessage });
});

it.each(["exhausted", "terminal"])("does not hide a %s error when a stale task snapshot still says running", retry => {
  const result = projectOpenmaTask({ ...snapshot, events: [...snapshot.events,
    { type: "session.error", error: { type: "new_server_error", message: "Execution failed", retry_status: { type: retry } } },
  ] });
  expect(result.turns[0]).toMatchObject({ status: "error", errorMessage: "Execution failed" });
  expect(result.row.activeTurnId).toBeUndefined();
});

it("keeps a retryable cloud error running and clears it after successful recovery", () => {
  const events = [...snapshot.events, { type: "session.error", error: { type: "model_overloaded", message: "Retrying provider", retry_status: { type: "retrying" } } }];
  expect(projectOpenmaTask({ ...snapshot, events }).turns[0]).toMatchObject({ status: "running" });
  const recovered = projectOpenmaTask({ ...snapshot, task: { ...snapshot.task, status: "idle" }, events: [...events,
    { type: "agent.message", id: "recovered", content: [{ type: "text", text: "Recovered" }] },
    { type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ] });
  expect(recovered.turns[0]).toMatchObject({ status: "complete", errorMessage: undefined });
});

it("shows a fallback for exhausted retries without an error event and isolates the next turn", () => {
  const result = projectOpenmaTask({ ...snapshot, task: { ...snapshot.task, status: "idle" }, events: [...snapshot.events,
    { type: "session.status_idle", stop_reason: { type: "retries_exhausted" } },
    { type: "user.message", id: "next", content: [{ type: "text", text: "Next" }] },
    { type: "agent.message", id: "answer", content: [{ type: "text", text: "OK" }] },
    { type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ] });
  expect(result.turns[0]).toMatchObject({ status: "error", errorMessage: expect.any(String) });
  expect(result.turns[1]).toMatchObject({ status: "complete", assistantText: "OK", errorMessage: undefined });
});
