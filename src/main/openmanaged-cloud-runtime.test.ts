import { describe, expect, it, vi } from "vitest";
import { OpenManagedCloudRuntimeClient } from "./openmanaged-cloud-runtime.js";

describe("OpenManagedCloudRuntimeClient", () => {
  it("creates cloud sessions in OpenManaged instead of a Backchat-owned cloud", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "sess-cloud" }), {
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

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.openma.dev/v1/sessions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "oma_test" }),
        body: JSON.stringify({
          agent: "agent-1",
          environment_id: "env-1",
          title: "From Backchat",
        }),
      }),
    );
  });

  it("streams the OpenManaged turn SSE without inventing another cloud protocol", async () => {
    const body = [
      'data: {"type":"agent.message_chunk","message_id":"m1","delta":"hi"}\n\n',
      'data: {"type":"session.status_idle"}\n\n',
    ].join("");
    const fetchImpl = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
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
      { type: "agent.message_chunk", message_id: "m1", delta: "hi" },
      { type: "session.status_idle" },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.openma.dev/v1/sessions/sess-cloud/messages",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ content: "hello" }) }),
    );
  });
});
