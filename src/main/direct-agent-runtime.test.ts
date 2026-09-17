import { describe, it, expect } from "vitest";
import { replayAgentUIEvents } from "@openma/common/agent-ui";
import type { OpenMAEvent } from "@openma/common/session-events/openma";
import * as runtime from "./direct-agent-runtime.js";

const page = (data: unknown[]) => Response.json({ data, has_more: false, first_id: null, last_id: null });
const options = { baseUrl: "https://third.test", apiKey: "secret", provider: "claude-managed" as const };

describe("direct managed agents", () => {
  it("uses only Claude public resources and normalizes history with common", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input)); calls.push(url.pathname);
      expect(new Headers(init?.headers).get("x-api-key")).toBe("secret");
      expect(url.searchParams.has("after_seq")).toBe(false);
      if (url.pathname === "/v1/agents") return page([{ id: "agent", name: "Claude" }]);
      if (url.pathname === "/v1/environments") return page([{ id: "env", name: "Cloud", config: { type: "cloud" }, archived_at: null }]);
      if (url.pathname.endsWith("/events")) return page([
        { id: "u", type: "user.message", content: [{ type: "text", text: "Hello" }], created_at: "2026-09-17T00:00:00Z" },
        { id: "m", type: "agent.message", content: [{ type: "text", text: "Hi" }], created_at: "2026-09-17T00:00:01Z" },
        { id: "done", type: "session.status_idle", stop_reason: { type: "end_turn" }, created_at: "2026-09-17T00:00:02Z" },
      ]);
      throw new Error(`Unexpected endpoint ${url.pathname}`);
    };
    const client = new runtime.DirectAgentRuntime({ ...options, fetchImpl });
    expect((await client.catalog()).cloudAgents).toEqual([{ id: "agent", name: "Claude" }]);
    const events = []; for await (const event of client.history("s")) events.push(event.canonical as OpenMAEvent);
    const state = replayAgentUIEvents("s", events);
    expect(state.turns[state.turnOrder[0]!]!.items.map(i => i.kind === "message" ? i.text : "")).toEqual(["Hello", "Hi"]);
    expect(state.turns[state.turnOrder[0]!]!.status).toBe("completed");
    expect(calls.some(path => path.includes("/oma/"))).toBe(false);
  });
  it("sends OpenAI Agents events with bearer authentication and idempotency, never Responses", async () => {
    const requests: Array<{ path: string; body: unknown; headers: Headers }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null, headers: new Headers(init?.headers) });
      return new Response(null, { status: 204 });
    };
    const client = new runtime.DirectAgentRuntime({ ...options, provider: "openai-agents", baseUrl: "https://third.test/openai/v1", fetchImpl });
    await client.sendEvent("s", { type: "user.message", content: [{ type: "text", text: "Hello" }], metadata: { "backchat.operation_id": "op" } });
    await client.sendEvent("s", { type: "user.interrupt" });
    expect(requests[0]!.path).toBe("/openai/v1/agents/sessions/s/events");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer secret");
    expect(requests[0]!.headers.get("Idempotency-Key")).toBe("op");
    expect(requests[0]!.body).toEqual({ events: [{ type: "agent.session.input.message", input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }] }] });
    expect(requests[1]!.body).toEqual({ events: [{ type: "agent.session.input.cancel" }] });
  });
  it("replays OpenAI items and terminal turns through the shared reducer", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/items")) return page([
        { id: "u", type: "message", role: "user", turn_id: "t", status: "completed", content: [{ type: "input_text", text: "Hello" }] },
        { id: "a", type: "message", role: "assistant", turn_id: "t", status: "completed", content: [{ type: "output_text", text: "Hi" }] },
      ]);
      if (path === "/agents/sessions/s") return Response.json({ id: "s", required_actions: [] });
      if (path.endsWith("/turns")) return page([{ id: "t", status: "failed", created_at: 1, completed_at: 2, error: { message: "Quota exceeded" }, subagent_id: null }]);
      throw new Error(`Unexpected endpoint ${path}`);
    };
    const client = new runtime.DirectAgentRuntime({ ...options, provider: "openai-agents", fetchImpl });
    const events = []; for await (const event of client.history("s")) events.push(event.canonical as OpenMAEvent);
    const state = replayAgentUIEvents("s", events);
    expect(state.turns.t!.status).toBe("failed");
    expect(state.turns.t!.items.map(i => i.kind === "message" ? i.text : "")).toEqual(["Hello", "Hi"]);
    expect(state.turns.t!.error).toBe("Quota exceeded");
  });
});

it("opens the OpenAI stream before loading history and releases its connection", async () => {
  const calls: string[] = [];
  const client = new runtime.DirectAgentRuntime({ ...options, provider: "openai-agents", fetchImpl: async (input) => {
    const path = new URL(String(input)).pathname; calls.push(path);
    if (path.endsWith("/events")) return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
    return page([]);
  } });
  const live = await client.openStream("s");
  const history = []; for await (const event of client.history("s")) history.push(event);
  expect(calls[0]).toBe("/agents/sessions/s/events");
  live.close();
});

it("keeps multiple Claude text deltas distinct and replaces them with the committed message", async () => {
  const wire = [
    { type: "user.message", id: "u", content: [{ type: "text", text: "Hello" }] },
    { type: "event_delta", event_id: "m", delta: { type: "content_delta", index: 0, content: { type: "text", text: "Hi" } } },
    { type: "event_delta", event_id: "m", delta: { type: "content_delta", index: 0, content: { type: "text", text: " there" } } },
    { type: "agent.message", id: "m", content: [{ type: "text", text: "Hi there" }] },
  ];
  const client = new runtime.DirectAgentRuntime({ ...options, fetchImpl: async () => new Response(wire.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } }) });
  const events = []; for await (const e of client.stream("s")) events.push(e);
  const chunks = events.filter(e => e.type === "agent.message_chunk");
  expect(chunks).toHaveLength(2);
  expect(new Set(chunks.map(e => e.id)).size).toBe(2);
  const state = replayAgentUIEvents("s", events.map(e => e.canonical as OpenMAEvent));
  expect(state.turns.u!.items.filter(i => i.kind === "message" && i.role === "assistant")).toMatchObject([{ text: "Hi there" }]);
});

it("restores outstanding OpenAI function results from session state, and validates replies against it", async () => {
  const requests: unknown[] = [];
  const client = new runtime.DirectAgentRuntime({ ...options, provider: "openai-agents", fetchImpl: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/items") || path.endsWith("/turns")) return page([]);
    if (path.endsWith("/events")) { requests.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); }
    return Response.json({ id: "s", status: "requires_action", required_actions: [{ type: "function_call", call_id: "call", turn_id: "turn", name: "Choose branch", arguments: { question: "Which branch?" } }] });
  } });
  const history = []; for await (const event of client.history("s")) history.push(event);
  expect(history.find(e => e.pendingActions)?.pendingActions).toMatchObject([{ id: "call", type: "custom_result", event: { name: "Choose branch" } }]);
  await client.sendEvent("s", { type: "user.custom_tool_result", custom_tool_use_id: "call", content: [{ type: "text", text: "main" }] });
  expect(requests).toEqual([{ events: [{ type: "agent.session.input.tool_result", call_id: "call", turn_id: "turn", success: true, output: "main" }] }]);
});
it("preserves OpenAI tool arguments and failed output in the shared tool model", async () => {
  const client = new runtime.DirectAgentRuntime({ ...options, provider: "openai-agents", fetchImpl: async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/items")) return page([
      { id: "f", type: "function_call", call_id: "call", name: "read_file", arguments: { path: "a.txt" }, status: "in_progress", turn_id: "t" },
      { id: "o", type: "function_call_output", call_id: "call", output: "Missing file", error: "Not found", status: "failed", turn_id: "t" },
    ]);
    if (path.endsWith("/turns")) return page([]);
    return Response.json({ id: "s", required_actions: [] });
  } });
  const events = []; for await (const e of client.history("s")) events.push(e.canonical as OpenMAEvent);
  const state = replayAgentUIEvents("s", events);
  expect(state.turns.t!.items).toMatchObject([{ kind: "tool", name: "read_file", rawInput: { path: "a.txt" }, rawOutput: "Missing file", status: "failed" }]);
});
