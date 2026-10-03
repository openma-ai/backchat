import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent,
} from "@agentclientprotocol/sdk";
import {
  acpForkRequestMeta,
  type AcpForkPoint,
} from "@openma/common/acp-runtime";
import { describe, expect, it } from "vitest";

import { AcpSessionImpl } from "./session";
import type { ChildHandle } from "./types";

const point: AcpForkPoint = {
  messageId: "assistant-1",
  messageText: "Hello",
  messageOccurrence: 1,
};

function createInMemoryAcpHarness(toAgent: (conn: AgentSideConnection) => Agent): {
  child: ChildHandle;
} {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  new AgentSideConnection(
    toAgent,
    ndJsonStream(agentToClient.writable, clientToAgent.readable),
  );
  return {
    child: {
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
    },
  };
}

describe("inclusive fork request meta", () => {
  it("deep-merges forkPoint into session/fork without dropping harness meta", async () => {
    let forkRequest: { _meta?: Record<string, unknown> } | undefined;
    let called = false;
    const harness = createInMemoryAcpHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            sessionCapabilities: { fork: {} },
            _meta: {
              jetbrains: { air: { fork: { version: 1, inclusive: true } } },
            },
          },
        };
      },
      async unstable_forkSession(params) {
        called = true;
        forkRequest = params as typeof forkRequest;
        return { sessionId: "forked-session" };
      },
      async newSession() {
        return { sessionId: "unused" };
      },
      async authenticate() {
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {
        return;
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "fork-point-contract",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/backchat-test" },
        mcpServers: [],
        forkFromAcpSessionId: "parent-acp-session",
        forkPoint: point,
        sessionRequestMeta: {
          claudeCode: { emitRawSDKMessages: ["task_started"] },
        },
      },
    });

    await session.init();
    await session.dispose();

    expect(called).toBe(true);
    expect(forkRequest?._meta).toEqual({
      claudeCode: { emitRawSDKMessages: ["task_started"] },
      ...acpForkRequestMeta(point),
    });
    expect(forkRequest?._meta).toMatchObject({
      jetbrains: {
        air: {
          fork: {
            version: 1,
            messageId: "assistant-1",
            messageFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            messageOccurrence: 1,
          },
        },
      },
    });
  });

  it("does not send session/fork when the agent cannot fork from a message", async () => {
    let called = false;
    const harness = createInMemoryAcpHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            sessionCapabilities: { fork: {} },
          },
        };
      },
      async unstable_forkSession() {
        called = true;
        return { sessionId: "should-not-fork" };
      },
      async newSession() {
        return { sessionId: "should-not-create" };
      },
      async authenticate() {
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {
        return;
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "fork-point-refused",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/backchat-test" },
        mcpServers: [],
        forkFromAcpSessionId: "parent-acp-session",
        forkPoint: point,
      },
    });

    await expect(session.init()).rejects.toThrow(/message-fork-not-advertised/);
    expect(called).toBe(false);
    await session.dispose();
  });
});
