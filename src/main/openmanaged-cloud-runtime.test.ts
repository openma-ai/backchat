import { describe, expect, it } from "vitest";
import { OpenManagedCloudRuntimeClient } from "./openmanaged-cloud-runtime.js";

describe("OpenManagedCloudRuntimeClient v1", () => {
  it("retains OpenMA chunk and pending-input extensions through the SDK SSE decoder", async () => {
    const events = [
      { type: "agent.message_chunk", message_id: "m", delta: "实时文本" },
      { type: "system.user_message_pending", event_id: "u", event: { type: "user.message", content: [] } },
    ];
    const client = new OpenManagedCloudRuntimeClient({ baseUrl: "https://example.com", apiKey: "key", fetchImpl: async () => {
      const bytes = new TextEncoder().encode(events.map((e) => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(""));
      return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
    } });
    const received = []; for await (const event of client.stream("session")) received.push(event);
    expect(received).toEqual(events);
  });
  it("reads all v1 history pages using numeric cursors and unwraps stored event rows", async () => {
    const cursors: string[] = [];
    const client = new OpenManagedCloudRuntimeClient({ baseUrl: "https://app.openma.dev", apiKey: "key", fetchImpl: async (url, init) => {
      const cursor = new URL(new Request(url, init).url).searchParams.get("after_seq")!; cursors.push(cursor);
      if (cursor === "0") return Response.json({ data: [{ seq: 1, type: "user.message", ts: 1000, data: { id: "u", type: "user.message", content: [{ type: "text", text: "hi" }] } }], has_more: true, next_page: "seq_1" });
      if (cursor === "1") return Response.json({ data: [{ seq: 2, type: "agent.message", ts: 2000, data: { id: "a", type: "agent.message", content: [{ type: "text", text: "hello" }] } }], has_more: false });
      throw new Error("history did not advance");
    } });
    const events = [];
    for await (const event of client.history("s")) events.push(event);
    expect(cursors).toEqual(["0", "1"]);
    expect(events).toEqual([
      { id: "u", type: "user.message", content: [{ type: "text", text: "hi" }], seq: 1, processed_at: "1970-01-01T00:00:01.000Z" },
      { id: "a", type: "agent.message", content: [{ type: "text", text: "hello" }], seq: 2, processed_at: "1970-01-01T00:00:02.000Z" },
    ]);
  });
  it("accepts the v1 server's empty 202 response without treating accepted input as failed", async () => {
    let sends = 0;
    const client = new OpenManagedCloudRuntimeClient({ baseUrl: "https://app.openma.dev", apiKey: "key", fetchImpl: async () => { sends++; return new Response(null, { status: 202 }); } });
    await expect(client.sendMessage("session", "Run this once")).resolves.toEqual([]);
    expect(sends).toBe(1);
  });
  it("accepts an empty 202 even when a server middleware adds a JSON content type", async () => {
    const client = new OpenManagedCloudRuntimeClient({ baseUrl: "https://example.com", apiKey: "key", fetchImpl: async () => new Response(null, { status: 202, headers: { "content-type": "application/json" } }) });
    await expect(client.sendEvent("session", { type: "user.tool_confirmation", tool_use_id: "tool", result: "allow" })).resolves.toBeUndefined();
  });
  it("creates a session with SDK headers and the selected workspace", async () => {
    const requests: Request[] = [];
    const client = new OpenManagedCloudRuntimeClient({
      baseUrl: "https://app.openma.dev", apiKey: "secret", workspaceId: "workspace-b",
      fetchImpl: async (url, init) => { requests.push(new Request(url, init)); return Response.json({ id: "sess-cloud" }); },
    });
    await expect(client.createSession({ agentId: "agent-1", environmentId: "env-1", title: "From Backchat" })).resolves.toEqual({ sessionId: "sess-cloud" });
    const request = requests[0]!;
    expect(new URL(request.url).pathname).toBe("/v1/sessions");
    expect(request.headers.get("x-active-tenant")).toBe("workspace-b");
    expect(request.headers.get("anthropic-beta")).toContain("managed-agents-");
    expect(await request.json()).toEqual({ agent: "agent-1", environment_id: "env-1", title: "From Backchat" });
  });

  it("uses events for input and independent SDK streaming with a resume cursor", async () => {
    const requests: Request[] = [];
    const client = new OpenManagedCloudRuntimeClient({ baseUrl: "https://app.openma.dev", apiKey: "secret",
      fetchImpl: async (url, init) => {
        const request = new Request(url, init); requests.push(request);
        if (request.method === "POST") return Response.json({ data: [{ id: "u1", type: "user.message", seq: 8 }] });
        const body = ': heartbeat\r\n\r\nevent: agent.message\r\nid: 9\r\ndata: {"type":"agent.message",\r\ndata: "id":"m1","seq":9,"content":[{"type":"text","text":"hello"}]}\r\n\r\n';
        const bytes = new TextEncoder().encode(body);
        return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
      },
    });
    await client.sendMessage("sess-cloud", "hello");
    const events = [];
    for await (const event of client.stream("sess-cloud", { afterSeq: 8 })) events.push(event);
    expect(events).toEqual([{ type: "agent.message", id: "m1", seq: 9, content: [{ type: "text", text: "hello" }] }]);
    expect(await requests[0]!.json()).toEqual({ events: [{ type: "user.message", content: [{ type: "text", text: "hello" }] }] });
    expect(new URL(requests[0]!.url).pathname).toBe("/v1/sessions/sess-cloud/events");
    expect(requests[1]!.headers.get("last-event-id")).toBe("8");
    expect(new URL(requests[1]!.url).searchParams.get("include")).toBe("chunks");
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("never retries ambiguous writes or exposes server response secrets in errors", async () => {
    let writes = 0;
    const client = new OpenManagedCloudRuntimeClient({ baseUrl: "https://app.openma.dev", apiKey: "secret",
      fetchImpl: async () => { writes++; return Response.json({ error: { message: "secret provider details" } }, { status: 503 }); },
    });
    await expect(client.createSession({ agentId: "a", environmentId: "e" })).rejects.not.toThrow("secret provider details");
    expect(writes).toBe(1);
  });
});
