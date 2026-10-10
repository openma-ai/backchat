import { TransformStream } from "node:stream/web";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { logoutAcpAgent, probeAgentAuthStatus } from "./probe.js";
import type { ChildHandle, Spawner } from "./types.js";

function connectProbeAgent(agentFactory: (connection: AgentSideConnection) => Agent): Spawner {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  const child: ChildHandle = {
    stdin: clientToAgent.writable,
    stdout: agentToClient.readable,
    stderr: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
    kill: async () => undefined,
    exited: Promise.resolve({ code: 0, signal: null }),
  };
  new AgentSideConnection(agentFactory, ndJsonStream(agentToClient.writable, clientToAgent.readable));
  return { async spawn() { return child; } };
}

class LogoutProbeAgent implements Agent {
  logoutCalls: unknown[] = [];
  constructor(private readonly advertise: boolean) {}
  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{ id: "login", name: "Login" }],
      agentCapabilities: {
        promptCapabilities: {},
        ...(this.advertise ? { auth: { logout: {} } } : {}),
      },
    };
  }
  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    return { sessionId: "session-1" };
  }
  async authenticate() { return {}; }
  async logout(params: unknown) {
    this.logoutCalls.push(params);
    return {};
  }
  async prompt(_params: PromptRequest): Promise<PromptResponse> {
    return { stopReason: "end_turn" };
  }
  async cancel() { return undefined; }
}

describe("logoutAcpAgent", () => {
  it("sends ACP logout when the agent advertised the capability", async () => {
    const agent = new LogoutProbeAgent(true);
    await expect(logoutAcpAgent({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-logout-test",
      spawner: connectProbeAgent(() => agent),
    })).resolves.toBeUndefined();
    expect(agent.logoutCalls).toEqual([{}]);
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-logout-test",
      spawner: connectProbeAgent(() => new LogoutProbeAgent(true)),
    })).resolves.toMatchObject({ supportsLogout: true, methodId: "login" });
  });

  it("does not send ACP logout when the capability is absent", async () => {
    const agent = new LogoutProbeAgent(false);
    await expect(logoutAcpAgent({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-logout-test",
      spawner: connectProbeAgent(() => agent),
    })).rejects.toThrow(/does not support ACP logout/);
    expect(agent.logoutCalls).toEqual([]);
    const status = await probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-logout-test",
      spawner: connectProbeAgent(() => new LogoutProbeAgent(false)),
    });
    expect(status.supportsLogout).toBeUndefined();
  });
});
