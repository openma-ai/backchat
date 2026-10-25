import { expect, test } from "vitest";
import { SessionStore } from "./session-store";

const routed = (session: string, update: Record<string, unknown>) => ({
  ...update, "_openma.acp.notification": { session_id: session },
});

test.each(["claude-acp", "dsh-acp"])("%s routes reusable RFD children, nullable patches, nested ownership and messages", (agent) => {
  const store = new SessionStore();
  store.apply({ type: "session.ready", session_id: "host", acp_session_id: "root", agent_id: agent, cwd: "/repo" });
  store.registerTurn("turn", "host", "delegate");
  const send = (session: string, update: Record<string, unknown>) => store.apply({ type: "session.event", session_id: "host", turn_id: "turn", event: routed(session, update) });
  send("root", { sessionUpdate: "subagent_update", sessionId: "child", title: "Audit", capabilities: { cancel: {} }, state: { state: "running" } });
  send("child", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "working" } });
  send("child", { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } });
  send("child", { sessionUpdate: "tool_call", toolCallId: "read", title: "Read", status: "completed" });
  send("root", { sessionUpdate: "subagent_update", sessionId: "child", state: { state: "idle", stopReason: "end_turn" } });
  let activity = store.subagentsFor("host")[0]!;
  expect(activity).toMatchObject({ childSessionId: "child", status: "complete" });
  expect(store.turnsFor("host")[0]).toMatchObject({ assistantText: "", thoughtText: "", status: "running" });
  expect(store.turnsFor(activity.viewSessionId)[0]).toMatchObject({ assistantText: "working", thoughtText: "thinking", status: "complete" });
  expect(store.projectTurn(store.turnsFor(activity.viewSessionId)[0]!).tools).toHaveLength(1);
  send("root", { sessionUpdate: "subagent_update", sessionId: "child", title: null, capabilities: {}, state: { state: "running" } });
  send("child", { sessionUpdate: "session_message", messageId: "task2", senderSessionId: "root", content: [{ type: "text", text: "next task" }] });
  send("child", { sessionUpdate: "session_message_chunk", messageId: "task2", content: { type: "text", text: "!" } });
  expect(store.subagentsFor("host")).toHaveLength(1);
  activity = store.subagentsFor("host")[0]!;
  expect(activity.status).toBe("running");
  expect(store.get(activity.viewSessionId)?.sessionMessages).toEqual([expect.objectContaining({ messageId: "task2", senderSessionId: "root", content: [{ type: "text", text: "next task" }, { type: "text", text: "!" }] })]);
  send("child", { sessionUpdate: "subagent_update", sessionId: "grandchild", title: "Nested" });
  expect(store.subagentsFor(activity.viewSessionId)).toEqual([expect.objectContaining({ childSessionId: "grandchild", status: "unknown" })]);
  send("root", { sessionUpdate: "subagent_update", sessionId: "grandchild", title: "illegal reparent" });
  expect(store.subagentsFor("host")).toHaveLength(1);
  const restored = new SessionStore();
  restored.apply({ type: "session.ready", session_id: "host", acp_session_id: "root", agent_id: agent, cwd: "/repo" });
  restored.replayHistory("host", store.openmaEventsFor("host").map((event, index) => ({
    seq: index + 1, type: "openma_event", ts: index, data: JSON.stringify(event),
  })));
  const restoredChild = restored.subagentsFor("host")[0]!;
  expect(restored.subagentsFor("host")).toHaveLength(1);
  expect(restored.get(restoredChild.viewSessionId)?.sessionMessages?.[0]?.content).toHaveLength(2);
  expect(restored.turnsFor(restoredChild.viewSessionId)[0]?.assistantText).toBe("working");
});

test("idle without a reported reason is not fabricated success; state null clears confirmation", () => {
  const store = new SessionStore();
  store.apply({ type: "session.ready", session_id: "host", acp_session_id: "root", agent_id: "claude-acp", cwd: "/repo" });
  const send = (state: unknown) => store.apply({ type: "session.event", session_id: "host", turn_id: "", event: routed("root", { sessionUpdate: "subagent_update", sessionId: "child", state }) });
  send({ state: "idle" });
  expect(store.subagentsFor("host")[0]?.status).toBe("unknown");
  send({ state: "running" });
  send(null);
  expect(store.subagentsFor("host")[0]?.status).toBe("unknown");
});

test("rejects a child announcing its root as a descendant", () => {
  const store = new SessionStore();
  store.apply({ type: "session.ready", session_id: "host", acp_session_id: "root", agent_id: "claude-acp", cwd: "/repo" });
  store.apply({ type: "session.event", session_id: "host", turn_id: "", event: routed("root", { sessionUpdate: "subagent_update", sessionId: "child" }) });
  const view = store.subagentsFor("host")[0]!.viewSessionId;
  store.apply({ type: "session.event", session_id: "host", turn_id: "", event: routed("child", { sessionUpdate: "subagent_update", sessionId: "root" }) });
  expect(store.subagentsFor(view)).toEqual([]);
});

test("replaying the same scoped log twice does not duplicate child text or message content", () => {
  const store = new SessionStore();
  store.apply({ type: "session.ready", session_id: "host", acp_session_id: "root", agent_id: "claude-acp", cwd: "/repo" });
  const send = (session: string, update: Record<string, unknown>) => store.apply({ type: "session.event", session_id: "host", turn_id: "", event: routed(session, update) });
  send("root", { sessionUpdate: "subagent_update", sessionId: "child", state: { state: "running" } });
  send("child", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "one" } });
  const rows = store.openmaEventsFor("host").map((event, i) => ({ seq: i + 1, ts: i, type: "openma_event", data: JSON.stringify(event) }));
  store.replayHistory("host", rows);
  store.replayHistory("host", rows);
  expect(store.subagentsFor("host")).toHaveLength(1);
  const view = store.subagentsFor("host")[0]!.viewSessionId;
  expect(store.turnsFor(view)[0]?.assistantText).toBe("one");
});

test.each([
  ["codex-acp", ""], ["codex-acp", "previous-root"],
  ["claude-acp", ""], ["claude-acp", "previous-root"],
])("%s root traffic is not a child merely because root identity is %j", (agent, knownRoot) => {
  const store = new SessionStore();
  store.apply({ type: "session.ready", session_id: "host", acp_session_id: knownRoot!, agent_id: agent!, cwd: "/repo" });
  store.registerTurn("turn", "host", "prompt");
  store.apply({ type: "session.event", session_id: "host", turn_id: "turn", event: routed("current-root", {
    sessionUpdate: "agent_message_chunk", content: { type: "text", text: "root answer" },
  }) });
  expect(store.turnsFor("host")[0]?.assistantText).toBe("root answer");
  expect(store.openmaEventsFor("host").filter((event) => event.type === "vendor.event")).toEqual([]);
});

test("replay retains root text alongside a previously misclassified RFD vendor row", () => {
  const store = new SessionStore();
  store.apply({ type: "session.ready", session_id: "host", acp_session_id: "root", agent_id: "codex-acp", cwd: "/repo" });
  const raw = routed("root", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "saved answer" } });
  const envelope = (id: string, type: string, data: unknown, extra = {}) => ({
    schema: "oma.event.v1", event_id: id, type, session_id: "host", turn_id: "turn",
    source: { kind: "harness", harness: "codex-acp" }, occurred_at: "2026-10-25T00:00:00Z", data, ...extra,
  });
  const events = [
    envelope("prompt", "user.message", { text: "prompt", input_kind: "prompt" }),
    envelope("answer", "agent.message_chunk", { text: "saved answer", content: { type: "text", text: "saved answer" } }, {
      raw: { source: "acp", method: "session/update", event_type: "agent_message_chunk", payload: raw },
    }),
    envelope("misclassified", "vendor.event", { harness: "acp", namespace: "subagent_sessions", name: "update", data: raw }),
    envelope("done", "turn.completed", { stop_reason: "end_turn" }),
  ];
  store.replayHistory("host", events.map((event, index) => ({ seq: index + 1, ts: index + 1, type: "openma_event", data: JSON.stringify(event) })));
  expect(store.turnsFor("host")).toEqual([expect.objectContaining({ promptText: "prompt", assistantText: "saved answer", status: "complete" })]);
});
