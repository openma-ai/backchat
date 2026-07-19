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
import { describe, expect, it, vi } from "vitest";

import {
  authenticateAgent,
  disposeAllAcpSetupProcesses,
  probeAgentAuthStatus,
  probeAgentSessionConfig,
} from "./probe.js";
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
  it("lets the app shutdown barrier dispose external-pending auth children", async () => {
    const delegate = connectProbeAgent(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [{ id: "browser-login", name: "Browser login" }],
          agentCapabilities: { promptCapabilities: {} },
        };
      },
      async newSession() {
        return { sessionId: "unused" };
      },
      async authenticate() {
        return new Promise(() => undefined);
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {
        return undefined;
      },
    }));
    const kill = vi.fn(async () => undefined);
    const spawner: Spawner = {
      async spawn(spec) {
        return {
          ...await delegate.spawn(spec),
          kill,
        };
      },
    };

    await expect(authenticateAgent({
      agent: { command: "browser-auth-agent" },
      cwd: "/tmp/backchat-acp-background-auth-test",
      spawner,
      agentAuthLaunchGraceMs: 1,
      backgroundAuthTimeoutMs: 60_000,
    })).resolves.toEqual({ status: "started" });

    await disposeAllAcpSetupProcesses();
    expect(kill).toHaveBeenCalledOnce();
  });

  it("preserves explicit inherited-env removals when spawning a probe", async () => {
    const delegate = connectProbeAgent(() => new AuthRequiredProbeAgent());
    let capturedEnv: Record<string, string | undefined> | undefined;
    const spawner: Spawner = {
      async spawn(spec) {
        capturedEnv = spec.env;
        return delegate.spawn(spec);
      },
    };

    await probeAgentAuthStatus({
      agent: {
        command: "fake-agent",
        env: { ACP_PARENT_SESSION: undefined },
      },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner,
    });

    expect(capturedEnv).toHaveProperty("ACP_PARENT_SESSION");
    expect(capturedEnv?.ACP_PARENT_SESSION).toBeUndefined();
  });

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

describe("ACP session probe", () => {
  it("returns the auth gate from the same full capability process", async () => {
    await expect(probeAgentSessionConfig({
      agent: { command: "auth-required-agent" },
      cwd: "/tmp/backchat-acp-full-auth-gate-test",
      spawner: connectProbeAgent(() => new AuthRequiredProbeAgent()),
      capabilitySettleMs: 10,
    })).resolves.toMatchObject({
      configOptions: [],
      availableCommands: [],
      auth: {
        status: "needs-auth",
        methodId: "login",
        methodName: "Login",
      },
    });
  });

  it("settles without available_commands_update and preserves session config", async () => {
    const delegate = connectProbeAgent(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { promptCapabilities: {} },
        };
      },
      async newSession() {
        return {
          sessionId: "probe-session",
          configOptions: [{
            id: "model",
            name: "Model",
            type: "select",
            currentValue: "test-model",
            options: [{ value: "test-model", name: "Test Model" }],
          }],
        } as NewSessionResponse;
      },
      async authenticate() {
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {
        return undefined;
      },
    }));
    const kill = vi.fn(async () => undefined);
    const spawner: Spawner = {
      async spawn(spec) {
        return {
          ...await delegate.spawn(spec),
          kill,
        };
      },
    };

    await expect(probeAgentSessionConfig({
      agent: { command: "no-command-event-agent" },
      cwd: "/tmp/backchat-acp-no-command-event-test",
      spawner,
      timeoutMs: 2_000,
      capabilitySettleMs: 10,
    })).resolves.toMatchObject({
      configOptions: [{
        id: "model",
        currentValue: "test-model",
      }],
      availableCommands: [],
    });
    expect(kill).toHaveBeenCalledOnce();
  });

  it("captures available commands emitted immediately after session creation", async () => {
    const spawner = connectProbeAgent((connection) => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { promptCapabilities: {} },
        };
      },
      async newSession() {
        setTimeout(() => {
          void connection.sessionUpdate({
            sessionId: "probe-session",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{
                name: "compact",
                description: "Compact the current context",
              }],
            },
          });
        }, 0);
        return {
          sessionId: "probe-session",
          configOptions: [{
            id: "model",
            name: "Model",
            type: "select",
            currentValue: "test-model",
            options: [{ value: "test-model", name: "Test Model" }],
          }],
        } as NewSessionResponse;
      },
      async authenticate() {
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {
        return undefined;
      },
    }));

    await expect(probeAgentSessionConfig({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-session-probe-test",
      spawner,
    })).resolves.toMatchObject({
      configOptions: [{
        id: "model",
        currentValue: "test-model",
      }],
      availableCommands: [{
        name: "compact",
        description: "Compact the current context",
      }],
    });
  });

  it("waits for available commands published asynchronously after session creation", async () => {
    const spawner = connectProbeAgent((connection) => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { promptCapabilities: {} },
        };
      },
      async newSession() {
        setTimeout(() => {
          void connection.sessionUpdate({
            sessionId: "probe-session",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{
                name: "review",
                description: "Review the current workspace",
              }],
            },
          });
        }, 500);
        return {
          sessionId: "probe-session",
          configOptions: [],
        } as NewSessionResponse;
      },
      async authenticate() {
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {
        return undefined;
      },
    }));

    await expect(probeAgentSessionConfig({
      agent: { command: "slow-command-agent" },
      cwd: "/tmp/backchat-acp-delayed-command-probe-test",
      spawner,
      timeoutMs: 2_000,
    })).resolves.toMatchObject({
      availableCommands: [{
        name: "review",
        description: "Review the current workspace",
      }],
    });
  });
});
