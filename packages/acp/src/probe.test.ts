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

class InvalidKeyProbeAgent implements Agent {
  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{ id: "api-key", name: "API Key" }],
      agentCapabilities: { promptCapabilities: {} },
    };
  }

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    throw new Error("Internal error: turn failed: Authentication Fails, Your api key: fadf is invalid");
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

class ApiKeyProbeAgent implements Agent {
  authenticateCalls: unknown[] = [];

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{
        id: "api-key",
        name: "API Key",
        description: "Save an API key to the harness credential store",
        _meta: { "api-key": { provider: "openai" } },
      } as never],
      agentCapabilities: { promptCapabilities: {} },
    };
  }

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    throw RequestError.authRequired();
  }

  async authenticate(params: unknown) {
    this.authenticateCalls.push(params);
    return {};
  }

  async prompt(_params: PromptRequest): Promise<PromptResponse> {
    return { stopReason: "end_turn" };
  }

  async cancel() {
    return undefined;
  }
}

class GatewayProbeAgent implements Agent {
  authenticateCalls: unknown[] = [];
  initializeCalls: unknown[] = [];

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    this.initializeCalls.push(params);
    return {
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{
        id: "gateway",
        name: "Custom model gateway",
        description: "Use a custom OpenAI-compatible gateway",
        _meta: { gateway: { protocol: "openai", restartRequired: "false" } },
      } as never],
      agentCapabilities: { promptCapabilities: {} },
    };
  }

  async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
    throw RequestError.authRequired();
  }

  async authenticate(params: unknown) {
    this.authenticateCalls.push(params);
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

  it("reports wrapped invalid-key session failures as needs-auth", async () => {
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => new InvalidKeyProbeAgent()),
    })).resolves.toMatchObject({
      status: "needs-auth",
      methodId: "api-key",
      methodName: "API Key",
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

  it("surfaces Codex-shaped api-key methods as an in-app agent form", async () => {
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => new ApiKeyProbeAgent()),
    })).resolves.toEqual({
      status: "needs-auth",
      methodId: "api-key",
      methodName: "API Key",
      methods: [{
        id: "api-key",
        name: "API Key",
        description: "Save an API key to the harness credential store",
        type: "agent",
        form: "fields",
        vars: [{ name: "api-key", label: "API key", secret: true }],
      }],
    });
  });

  it("sends an API key through authenticate _meta instead of env overrides", async () => {
    const agent = new ApiKeyProbeAgent();

    await expect(authenticateAgent({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => agent),
      methodId: "api-key",
      secret: "sk-test-abcdef",
    })).resolves.toEqual({ status: "completed" });
    expect(agent.authenticateCalls).toEqual([{
      methodId: "api-key",
      _meta: { "api-key": { apiKey: "sk-test-abcdef" } },
    }]);
  });

  it("surfaces Codex-shaped gateway methods as an in-app agent form", async () => {
    const agent = new GatewayProbeAgent();
    await expect(probeAgentAuthStatus({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => agent),
    })).resolves.toEqual({
      status: "needs-auth",
      methodId: "gateway",
      methodName: "Custom model gateway",
      methods: [{
        id: "gateway",
        name: "Custom model gateway",
        description: "Use a custom OpenAI-compatible gateway",
        type: "agent",
        form: "fields",
        vars: [
          { name: "baseUrl", label: "Base URL" },
          { name: "api-key", label: "API key", secret: true },
          { name: "providerName", label: "Provider", optional: true },
        ],
      }],
    });
    expect(agent.initializeCalls).toEqual([expect.objectContaining({
      clientCapabilities: expect.objectContaining({
        auth: expect.objectContaining({
          _meta: { gateway: true },
        }),
      }),
    })]);
  });

  it("encodes authenticate _meta from form values using the method _meta, not the method id", async () => {
    class ConventionProbeAgent implements Agent {
      authenticateCalls: unknown[] = [];
      constructor(private readonly method: Record<string, unknown>) {}
      async initialize(): Promise<InitializeResponse> {
        return {
          protocolVersion: PROTOCOL_VERSION,
          authMethods: [this.method as never],
          agentCapabilities: { promptCapabilities: {} },
        };
      }
      async newSession(): Promise<NewSessionResponse> {
        throw RequestError.authRequired();
      }
      async authenticate(params: unknown) {
        this.authenticateCalls.push(params);
        return {};
      }
      async prompt(): Promise<PromptResponse> {
        return { stopReason: "end_turn" };
      }
      async cancel() {
        return undefined;
      }
    }

    const keyed = new ConventionProbeAgent({
      id: "provider-login",
      name: "Provider key",
      _meta: { "api-key": { provider: "anthropic" } },
    });
    await expect(authenticateAgent({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => keyed),
      methodId: "provider-login",
      values: { "api-key": "sk-ant" },
    })).resolves.toEqual({ status: "completed" });
    expect(keyed.authenticateCalls).toEqual([{
      methodId: "provider-login",
      _meta: { "api-key": { apiKey: "sk-ant" } },
    }]);

    const gateway = new ConventionProbeAgent({
      id: "custom-endpoint",
      name: "Custom endpoint",
      _meta: { gateway: { protocol: "openai" } },
    });
    await expect(authenticateAgent({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => gateway),
      methodId: "custom-endpoint",
      values: {
        baseUrl: "https://www.example.com",
        "api-key": "TOKEN",
        providerName: "custom",
      },
    })).resolves.toEqual({ status: "completed" });
    expect(gateway.authenticateCalls).toEqual([{
      methodId: "custom-endpoint",
      _meta: {
        gateway: {
          baseUrl: "https://www.example.com",
          headers: { Authorization: "Bearer TOKEN" },
          providerName: "custom",
        },
      },
    }]);

    const unknown = new ConventionProbeAgent({
      id: "gateway",
      name: "Looks like a gateway",
    });
    await expect(authenticateAgent({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => unknown),
      methodId: "gateway",
      values: { baseUrl: "https://www.example.com", "api-key": "TOKEN" },
    })).resolves.toEqual({ status: "completed" });
    expect(unknown.authenticateCalls).toEqual([{ methodId: "gateway" }]);
  });

  it("sends gateway settings through authenticate _meta", async () => {
    const agent = new GatewayProbeAgent();

    await expect(authenticateAgent({
      agent: { command: "fake-agent" },
      cwd: "/tmp/backchat-acp-probe-test",
      spawner: connectProbeAgent(() => agent),
      methodId: "gateway",
      gateway: {
        baseUrl: "https://www.example.com",
        headers: { Authorization: "Bearer TOKEN" },
        providerName: "custom",
      },
    })).resolves.toEqual({ status: "completed" });
    expect(agent.authenticateCalls).toEqual([{
      methodId: "gateway",
      _meta: {
        gateway: {
          baseUrl: "https://www.example.com",
          headers: { Authorization: "Bearer TOKEN" },
          providerName: "custom",
        },
      },
    }]);
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
