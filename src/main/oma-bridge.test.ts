import { describe, expect, it, vi } from "vitest";
import {
  OmaBridgeClient,
  omaBridgeWebSocketUrl,
  type OmaBridgeSocket,
} from "./oma-bridge.js";

class FakeSocket implements OmaBridgeSocket {
  readyState = 0;
  sent: string[] = [];
  #handlers = new Map<string, Array<(...args: any[]) => void>>();

  on(event: string, handler: (...args: any[]) => void): this {
    this.#handlers.set(event, [...(this.#handlers.get(event) ?? []), handler]);
    return this;
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    for (const handler of this.#handlers.get("open") ?? []) handler();
  }

  receive(message: unknown): void {
    for (const handler of this.#handlers.get("message") ?? []) {
      handler(Buffer.from(JSON.stringify(message)));
    }
  }
}

describe("OmaBridgeClient", () => {
  it("canonicalizes the legacy production origin before WebSocket upgrade", () => {
    expect(omaBridgeWebSocketUrl("https://openma.dev")).toBe(
      "wss://app.openma.dev/agents/runtime/_attach",
    );
  });

  it("shares one host session manager for cloud turns and forwards canonical bridge events", async () => {
    const socket = new FakeSocket();
    const host = {
      start: vi.fn(async () => ({ status: "ready" as const, session_id: "sid", acp_session_id: "acp", agent_id: "claude-acp", cwd: "/tmp" })),
      prompt: vi.fn(async () => undefined),
      cancel: vi.fn(),
      dispose: vi.fn(async () => undefined),
      announceAll: vi.fn(),
    };
    const client = new OmaBridgeClient({
      credentials: {
        serverUrl: "https://app.openma.dev",
        token: "sk_machine_test",
        machineId: "machine-test",
      },
      host,
      detectAgents: async () => [{ id: "claude-acp", binary: "claude-agent-acp" }],
      socketFactory: () => socket,
    });

    await client.connect();
    socket.open();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      type: "hello",
      machine_id: "machine-test",
      agents: [{ id: "claude-acp", binary: "claude-agent-acp" }],
    });

    socket.receive({
      type: "session.start",
      session_id: "sid",
      tenant_id: "tenant-1",
      agent_id: "claude-acp",
    });
    socket.receive({
      type: "session.prompt",
      session_id: "sid",
      tenant_id: "tenant-1",
      turn_id: "turn-1",
      text: "hello",
    });
    expect(host.start).toHaveBeenCalledWith(expect.objectContaining({ session_id: "sid", agent_id: "claude-acp" }));
    expect(host.prompt).toHaveBeenCalledWith(expect.objectContaining({ session_id: "sid", turn_id: "turn-1", text: "hello" }));

    client.handleSessionEvent({
      type: "session.event",
      session_id: "sid",
      turn_id: "turn-1",
      event: { sessionUpdate: "agent_message_chunk" },
    });
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: "session.event",
      session_id: "sid",
      tenant_id: "tenant-1",
      turn_id: "turn-1",
    });
  });
});
