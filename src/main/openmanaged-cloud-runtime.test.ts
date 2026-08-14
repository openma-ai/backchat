import { describe, expect, it, vi } from "vitest";
import { OpenManagedCloudRuntimeClient } from "./openmanaged-cloud-runtime.js";

describe("OpenManagedCloudRuntimeClient", () => {
  it("discovers models through the official beta Models API", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
      data: [
        {
          id: "fast",
          display_name: "Fast",
          type: "model",
          created_at: "2026-08-07T00:00:00.000Z",
          capabilities: null,
          max_input_tokens: null,
          max_tokens: null,
          allowed_fallback_models: null,
        },
        {
          id: "deep",
          display_name: "Deep Reasoning",
          type: "model",
          created_at: "2026-08-06T00:00:00.000Z",
          capabilities: null,
          max_input_tokens: null,
          max_tokens: null,
          allowed_fallback_models: null,
        },
      ],
      has_more: false,
      first_id: "fast",
      last_id: "deep",
    }));
    const client = new OpenManagedCloudRuntimeClient({
      baseUrl: "https://app.openma.dev/",
      apiKey: "oma_test",
      fetchImpl,
    });

    await expect(client.listModels()).resolves.toEqual([
      { id: "fast", displayName: "Fast" },
      { id: "deep", displayName: "Deep Reasoning" },
    ]);

    const [input, init] = fetchImpl.mock.calls[0]!;
    const request = new Request(input, init);
    const url = new URL(request.url);
    expect(`${request.method} ${url.pathname}`).toBe("GET /v1/models");
    expect(url.searchParams.get("beta")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(request.headers.get("x-api-key")).toBe("oma_test");
  });

  it("recognizes the staging MCP Tunnels unsupported contract through the SDK", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
      type: "error",
      error: {
        type: "not_implemented",
        message: "MCP Tunnels are not supported by Open Managed Agents",
      },
      request_id: "req_lab",
    }, { status: 501 }));
    const client = new OpenManagedCloudRuntimeClient({
      baseUrl: "https://app.openma.dev",
      apiKey: "oma_test",
      fetchImpl,
    });

    await expect(client.verifyTunnelsUnsupported()).resolves.toEqual({
      status: 501,
      type: "not_implemented",
      message: "MCP Tunnels are not supported by Open Managed Agents",
    });
    const [input, init] = fetchImpl.mock.calls[0]!;
    const request = new Request(input, init);
    expect(`${request.method} ${new URL(request.url).pathname}`).toBe("POST /v1/tunnels");
    expect(request.headers.get("anthropic-beta")).toContain("mcp-tunnels-2026-06-22");
  });

  it("creates cloud sessions in OpenManaged instead of a Backchat-owned cloud", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ id: "sess-cloud" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const client = new OpenManagedCloudRuntimeClient({
      baseUrl: "https://app.openma.dev",
      apiKey: "oma_test",
      fetchImpl,
    });

    await expect(client.createSession({
      agentId: "agent-1",
      environmentId: "env-1",
      title: "From Backchat",
    })).resolves.toEqual({ sessionId: "sess-cloud" });

    const [input, init] = fetchImpl.mock.calls[0]!;
    const request = new Request(input, init);
    expect(`${request.method} ${new URL(request.url).pathname}`).toBe(
      "POST /v1/sessions",
    );
    expect(request.headers.get("x-api-key")).toBe("oma_test");
    expect(request.headers.get("anthropic-beta")).toContain(
      "managed-agents-2026-04-01",
    );
    await expect(request.json()).resolves.toEqual({
      agent: "agent-1",
      environment_id: "env-1",
      title: "From Backchat",
    });
  });

  it("streams the OpenManaged turn SSE without inventing another cloud protocol", async () => {
    const body = [
      'event: event_start\ndata: {"type":"event_start","event":{"type":"agent.message","id":"m1"}}\n\n',
      'event: event_delta\ndata: {"type":"event_delta","event_id":"m1","delta":{"type":"content_delta","index":0,"content":{"type":"text","text":"hi"}}}\n\n',
      'event: session.status_idle\ndata: {"type":"session.status_idle"}\n\n',
    ].join("");
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "GET" && request.url.includes("/events/stream?")) {
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (request.method === "POST" && request.url.includes("/events?")) {
        return Response.json({ type: "event_batch", accepted: 1 }, { status: 202 });
      }
      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    const client = new OpenManagedCloudRuntimeClient({
      baseUrl: "https://app.openma.dev/",
      apiKey: "oma_test",
      fetchImpl,
    });

    const events: unknown[] = [];
    for await (const event of client.prompt("sess-cloud", "hello")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "event_start", event: { type: "agent.message", id: "m1" } },
      {
        type: "event_delta",
        event_id: "m1",
        delta: {
          type: "content_delta",
          index: 0,
          content: { type: "text", text: "hi" },
        },
      },
      { type: "session.status_idle" },
    ]);
    const requests = fetchImpl.mock.calls.map(([input, init]) => new Request(input, init));
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`))
      .toEqual([
        "GET /v1/sessions/sess-cloud/events/stream",
        "POST /v1/sessions/sess-cloud/events",
      ]);
    await expect(requests[1]!.json()).resolves.toEqual({
      events: [{ type: "user.message", content: [{ type: "text", text: "hello" }] }],
    });
    expect(requests.every((request) =>
      request.headers.get("anthropic-beta")?.includes("managed-agents-2026-04-01")
    )).toBe(true);
  });
});
