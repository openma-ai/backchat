import { TransformStream } from "node:stream/web";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Agent,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";

import { authenticateAgent, probeAgentAuthStatus } from "./probe.js";
import type { ChildHandle, Spawner } from "./types.js";

function makeStreamPair(): {
  child: ChildHandle;
  agentInput: ReadableStream<Uint8Array>;
  agentOutput: WritableStream<Uint8Array>;
} {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  return {
    child: {
      stdin: clientToAgent.writable,
      stdout: agentToClient.readable,
      stderr: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      kill: async () => undefined,
      exited: Promise.resolve({ code: 0, signal: null }),
    },
    agentInput: clientToAgent.readable,
    agentOutput: agentToClient.writable,
  };
}

function connectProbeAgent(agentFactory: (connection: AgentSideConnection) => Agent): Spawner {
  const pair = makeStreamPair();
  new AgentSideConnection(agentFactory, ndJsonStream(pair.agentOutput, pair.agentInput));
  return {
    async spawn() {
      return pair.child;
    },
  };
}

class AuthRequiredProbeAgent implements Agent {
  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{ id: "login", name: "Login" }],
      agentCapabilities: { promptCapabilities: {} },
    };
  }

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    throw RequestError.authRequired();
  }

  async authenticate() {
    return {};
  }

  async prompt(_params: PromptRequest): Promise<PromptResponse> {
    return { stopReason: "end_turn" };
  }

  async cancel() {
    return undefined;
  }
}

class EnvVarProbeAgent implements Agent {
  newSessionCalls = 0;
  authenticateCalls = 0;

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{
        id: "openai-key",
        name: "OpenAI API key",
        description: "Set the OPENAI_API_KEY environment variable.",
        type: "env_var",
        vars: [{ name: "OPENAI_API_KEY", label: "API key", secret: true }],
      } as never],
      agentCapabilities: { promptCapabilities: {} },
    };
  }

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    this.newSessionCalls++;
    return { sessionId: "env-session" };
  }

  async authenticate() {
    this.authenticateCalls++;
    return {};
  }

  async prompt(_params: PromptRequest): Promise<PromptResponse> {
    return { stopReason: "end_turn" };
  }

  async cancel() {
    return undefined;
  }
}

class UnsupportedAuthProbeAgent implements Agent {
  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{
        id: "magic-card",
        name: "Magic Card",
        type: "card",
      } as never],
      agentCapabilities: { promptCapabilities: {} },
    };
  }

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    return { sessionId: "unsupported-session" };
  }

  async authenticate() {
    return {};
  }

  async prompt(_params: PromptRequest): Promise<PromptResponse> {
    return { stopReason: "end_turn" };
  }

  async cancel() {
    return undefined;
  }
}

describe("ACP auth probe", () => {
  it("reports auth_required without starting authentication", async () => {
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => new AuthRequiredProbeAgent()),
    })).resolves.toEqual({
      status: "needs-auth",
      methodId: "login",
      methodName: "Login",
      methods: [{ id: "login", name: "Login", type: "agent" }],
    });
  });

  it("reports missing env-var credentials without creating a session", async () => {
    const agent = new EnvVarProbeAgent();

    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => agent),
      env: {},
    })).resolves.toEqual({
      status: "needs-auth",
      methodId: "openai-key",
      methodName: "OpenAI API key",
      message: "Missing credential variable: OPENAI_API_KEY.",
      methods: [{
        id: "openai-key",
        name: "OpenAI API key",
        description: "Set the OPENAI_API_KEY environment variable.",
        type: "env_var",
        vars: [{ name: "OPENAI_API_KEY", label: "API key", secret: true }],
      }],
    });
    expect(agent.newSessionCalls).toBe(0);
  });

  it("verifies env-var auth with session/new once required variables exist", async () => {
    const agent = new EnvVarProbeAgent();

    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => agent),
      env: { OPENAI_API_KEY: "sk-test" },
    })).resolves.toMatchObject({
      status: "configured",
      methodId: "openai-key",
      methodName: "OpenAI API key",
    });
    expect(agent.newSessionCalls).toBe(1);
  });

  it("refuses to run authenticate for env-var credential methods", async () => {
    const agent = new EnvVarProbeAgent();

    await expect(authenticateAgent({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => agent),
      env: {},
      methodId: "openai-key",
    })).rejects.toThrow(/requires credential variables.*OPENAI_API_KEY/);
    expect(agent.authenticateCalls).toBe(0);
  });

  it("blocks unsupported auth methods instead of treating them as no auth", async () => {
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => new UnsupportedAuthProbeAgent()),
    })).resolves.toEqual({
      status: "unknown",
      message: "No supported ACP auth method is available. Unsupported methods: card.",
    });
  });
});
