import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream, type Agent } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { AcpSessionImpl } from "./session";
import type { ChildHandle } from "./types";

describe("AcpSessionImpl", () => {
  it("does not replay session/load transcript updates on the next prompt", async () => {
    const harness = createInMemoryAcpHarness((conn) => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { loadSession: true },
        };
      },
      async loadSession(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "old history" },
          },
        });
        return {};
      },
      async newSession() {
        return { sessionId: "fresh-session" };
      },
      async prompt(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "new answer" },
          },
        });
        return { stopReason: "end_turn" };
      },
      async authenticate() {
        return {};
      },
      async cancel() {
        return;
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "test-acp-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/backchat-test" },
        resumeAcpSessionId: "existing-session",
        mcpServers: [],
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("continue")) {
      events.push(event);
    }
    await session.dispose();

    const chunks = events
      .filter((event): event is { sessionUpdate: string; content?: { text?: string } } =>
        typeof event === "object" &&
        event !== null &&
        (event as { sessionUpdate?: string }).sessionUpdate === "agent_message_chunk",
      )
      .map((event) => event.content?.text);

    expect(chunks).toEqual(["new answer"]);
  });
});

function createInMemoryAcpHarness(toAgent: (conn: AgentSideConnection) => Agent): {
  child: ChildHandle;
} {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();

  new AgentSideConnection(
    toAgent,
    ndJsonStream(agentToClient.writable, clientToAgent.readable),
  );

  const child: ChildHandle = {
    stdin: clientToAgent.writable,
    stdout: agentToClient.readable,
    stderr: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    exited: Promise.resolve({ code: 0, signal: null }),
    async kill() {
      await Promise.allSettled([
        clientToAgent.writable.close(),
        agentToClient.writable.close(),
      ]);
    },
  };

  return { child };
}
