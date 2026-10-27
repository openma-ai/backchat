import { agent as acpAgent, ndJsonStream } from "@agentclientprotocol/sdk/unstable";
import { AcpSessionImpl } from "./session";
import { expect, test } from "vitest";
import type { ChildHandle } from "./types";

test("negotiates subagents and retains child session identity through the shared runtime", async () => {
  const incoming = new TransformStream<Uint8Array, Uint8Array>();
  const outgoing = new TransformStream<Uint8Array, Uint8Array>();
  let subagents: unknown;
  let permissionSession: string | undefined;
  let connection: ReturnType<ReturnType<typeof acpAgent>["connect"]>;
  const handlers = {
    async initialize(params: { clientCapabilities?: { subagents?: unknown } }) {
      subagents = params.clientCapabilities?.subagents;
      return { protocolVersion: 1, agentCapabilities: {} };
    },
    async newSession() { return { sessionId: "root" }; },
    async prompt() {
      await connection.client.notify("session/update", { sessionId: "root", update: {
        sessionUpdate: "subagent_update", sessionId: "child", title: "Review", state: { state: "running" },
      } });
      await connection.client.notify("session/update", { sessionId: "child", update: {
        sessionUpdate: "agent_message_chunk", content: { type: "text", text: "child text" },
      } });
      const decision = await connection.client.request("session/request_permission", {
        sessionId: "child", toolCall: { toolCallId: "child-tool" },
        options: [{ optionId: "once", name: "Once", kind: "allow_once" }],
      });
      expect(decision.outcome).toEqual({ outcome: "cancelled" });
      return { stopReason: "end_turn" as const };
    },
    async cancel() {},
  };
  const server = acpAgent().onConnect((value) => { connection = value; })
    .onRequest("initialize", ({ params }) => handlers.initialize(params))
    .onRequest("session/new", () => handlers.newSession())
    .onRequest("session/prompt", () => handlers.prompt())
    .onNotification("session/cancel", () => handlers.cancel())
    .connect(ndJsonStream(outgoing.writable, incoming.readable));
  const child: ChildHandle = {
    stdin: incoming.writable, stdout: outgoing.readable,
    stderr: new ReadableStream({ start(c) { c.close(); } }),
    exited: new Promise(() => {}), async kill() {},
  };
  const session = new AcpSessionImpl({ child, id: "test", options: {
    agent: { command: "fake" }, clientCapabilityOverlay: { subagents: {} },
    clientCallbacks: { requestPermission: async (params) => {
      permissionSession = params.sessionId;
      return { outcome: { outcome: "cancelled" } };
    } },
  } });
  try {
    await session.init();
    const events = [];
    for await (const event of session.prompt([{ type: "text", text: "go" }])) events.push(event);
    expect(subagents).toEqual({});
    expect(permissionSession).toBe("child");
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionUpdate: "subagent_update", sessionId: "child" }),
      expect.objectContaining({ sessionUpdate: "agent_message_chunk", "_openma.acp.notification": { session_id: "child" } }),
    ]));
  } finally { await session.dispose(); void server; }
});
