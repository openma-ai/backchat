import { describe, expect, test } from "vitest";
import { resolveAgentRuntimeAdapter } from "./agent-runtime-adapters";
import { SessionStore } from "./session-store";

// Wire shapes from @openma/deepseek-harness-acp 0.4.39 SessionProjection.
const lifecycle = (state: string, stopReason?: string) => ({
  sessionUpdate: "session_info_update",
  _meta: { dsh: { event: "subagent/lifecycle", subagent: {
    state, runId: "run-1", childSessionId: "child-1", provider: "in-process", local: true,
    ...(stopReason ? { stopReason } : {}),
  } } },
});
const child = (update: Record<string, unknown>) => ({
  ...update,
  _meta: { dsh: { subagent: {
    childSessionId: "child-1", parentToolCallId: "subagent:run-1", provider: "in-process",
  } } },
});

describe("DSH native subagents", () => {
  test("resolves only the DSH harness and never infers a child from a tool name", () => {
    const adapter = resolveAgentRuntimeAdapter("dsh-acp");
    expect(adapter?.provider).toBe("dsh");
    expect(adapter?.nativeAgentToolUpdates({ toolCallId: "ordinary", toolName: "subagent" })).toEqual([]);
  });

  test.each([
    ["completed", "complete"], ["error", "error"], ["aborted", "cancelled"],
    ["max-tokens", "unknown"], ["blocked", "unknown"], ["future-reason", "unknown"],
  ])("maps the explicit DSH ending %s without claiming task success", (reason, status) => {
    expect(resolveAgentRuntimeAdapter("dsh-acp")?.nativeAgentRawUpdates(lifecycle("finished", reason)))
      .toEqual([expect.objectContaining({ provider: "dsh", childId: "child-1", status, reason })]);
  });

  test("rejects incomplete lifecycle identity and ignores unrelated metadata", () => {
    const adapter = resolveAgentRuntimeAdapter("dsh-acp");
    expect(adapter).toBeDefined();
    expect(adapter?.nativeAgentRawUpdates({ sessionUpdate: "session_info_update", _meta: { dsh: {
      event: "subagent/lifecycle", subagent: { state: "started", childSessionId: "child-1" },
    } } })).toEqual([]);
    expect(adapter?.nativeAgentRawUpdates({ ...lifecycle("started"), _meta: { codex: {} } })).toEqual([]);
  });

  test("routes structured lifecycle, text, thoughts and tools into one child without polluting its parent", () => {
    const store = new SessionStore();
    store.apply({ type: "session.ready", session_id: "parent", acp_session_id: "acp-parent", agent_id: "dsh-acp", cwd: "/repo" });
    store.registerTurn("parent-turn", "parent", "Investigate");
    const send = (event: unknown) => store.apply({ type: "session.event", session_id: "parent", turn_id: "parent-turn", event });
    send(lifecycle("started"));
    send(child({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Child answer" } }));
    send(child({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Child thought" } }));
    send(child({ sessionUpdate: "tool_call", toolCallId: "read-1", title: "Read file", kind: "read", status: "completed", rawInput: { path: "/repo/a.ts" } }));
    send(lifecycle("finished", "completed"));
    const agents = store.subagentsFor("parent");
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ childSessionId: "child-1", status: "complete", native: { provider: "dsh" } });
    expect(store.turnsFor("parent")[0]).toMatchObject({ assistantText: "", thoughtText: "", status: "running" });
    const turn = store.turnsFor(agents[0]!.viewSessionId)[0]!;
    expect(turn).toMatchObject({ assistantText: "Child answer", thoughtText: "Child thought", status: "complete" });
    expect(store.projectTurn(turn).tools).toEqual([expect.objectContaining({ toolCallId: "read-1" })]);
    const restored = new SessionStore();
    restored.apply({ type: "session.ready", session_id: "parent", acp_session_id: "acp-parent", agent_id: "dsh-acp", cwd: "/repo" });
    restored.replayHistory("parent", store.openmaEventsFor("parent").map((event, index) => ({
      seq: index + 1, type: "openma_event", data: JSON.stringify(event), ts: 1000 + index,
    })));
    expect(restored.subagentsFor("parent")).toEqual([expect.objectContaining({
      childSessionId: "child-1", status: "complete", native: expect.objectContaining({ provider: "dsh" }),
    })]);
    const restoredChild = restored.subagentsFor("parent")[0]!;
    expect(restored.turnsFor(restoredChild.viewSessionId)[0]).toMatchObject({
      assistantText: "Child answer", thoughtText: "Child thought", status: "complete",
    });
  });
});
