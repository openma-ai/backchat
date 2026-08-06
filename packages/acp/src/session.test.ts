import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent,
  type ContentBlock,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { AcpSessionImpl } from "./session";
import type { ChildHandle } from "./types";

describe("AcpSessionImpl", () => {
  it("filters HTTP and SSE MCP servers unless the agent advertises support", async () => {
    let sentMcpServers: unknown;
    const harness = createInMemoryAcpHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            mcpCapabilities: {
              http: true,
              sse: false,
            },
          },
        };
      },
      async newSession(params) {
        sentMcpServers = params.mcpServers;
        return { sessionId: "fresh-session" };
      },
      async prompt() {
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
        mcpServers: [
          { type: "stdio", name: "filesystem", command: "fs", args: [], env: [] },
          { type: "http", name: "backchat-browser", url: "http://127.0.0.1:1234/mcp", headers: [] },
          { type: "sse", name: "legacy-sse", url: "http://127.0.0.1:1235/sse", headers: [] },
        ] as never,
      },
    });

    await session.init();
    await session.dispose();

    expect(sentMcpServers).toEqual([
      { name: "filesystem", command: "fs", args: [], env: [] },
      { type: "http", name: "backchat-browser", url: "http://127.0.0.1:1234/mcp", headers: [] },
    ]);
  });

  it("turns a first-prompt broken pipe into an actionable process-exit error", async () => {
    const child = createChildThatExitsOnFirstPrompt();
    const session = new AcpSessionImpl({
      child,
      id: "test-first-prompt-exit",
      options: {
        agent: { command: "fake-agent", cwd: "/work/app" },
        mcpServers: [],
      },
    });

    await session.init();

    const consumePrompt = async () => {
      for await (const _event of session.prompt("hello")) {
        // The child exits before producing a prompt event.
      }
    };

    const error = await consumePrompt().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "The agent process exited before it could accept the prompt",
    );
    expect((error as Error).message).not.toMatch(/EPIPE/i);
    expect(session.isAlive()).toBe(false);
    await session.dispose();
  });

  it("passes additional workspace roots through ACP session/new", async () => {
    let newSessionRequest:
      | {
          cwd: string;
          mcpServers: unknown[];
          additionalDirectories?: string[];
        }
      | undefined;
    const harness = createInMemoryAcpHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            sessionCapabilities: { additionalDirectories: {} },
          },
        };
      },
      async newSession(params) {
        newSessionRequest = params as typeof newSessionRequest;
        return { sessionId: "multi-root-session" };
      },
      async prompt() {
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
      id: "test-multi-root-session",
      options: {
        agent: { command: "fake-agent", cwd: "/work/app" },
        mcpServers: [],
        additionalDirectories: ["/work/docs", "/work/backend"],
      },
    });

    await session.init();
    expect(session.supportsAdditionalDirectories).toBe(true);
    await session.dispose();

    expect(newSessionRequest).toEqual({
      cwd: "/work/app",
      mcpServers: [],
      additionalDirectories: ["/work/docs", "/work/backend"],
    });
  });

  it("does not send additionalDirectories when the agent has not advertised support", async () => {
    let newSessionRequest: unknown;
    const harness = createInMemoryAcpHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession(params) {
        newSessionRequest = params;
        return { sessionId: "single-root-session" };
      },
      async prompt() {
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
      id: "test-single-root-session",
      options: {
        agent: { command: "fake-agent", cwd: "/work/app" },
        mcpServers: [],
        additionalDirectories: ["/work/docs"],
      },
    });

    await session.init();
    expect(session.supportsAdditionalDirectories).toBe(false);
    await session.dispose();

    expect(newSessionRequest).toEqual({
      cwd: "/work/app",
      mcpServers: [],
    });
  });

  it("forks an existing ACP session when the unstable fork capability is advertised", async () => {
    let forkRequest:
      | { sessionId: string; cwd: string; mcpServers?: unknown[] }
      | undefined;
    let newSessionCalled = false;
    const harness = createInMemoryAcpHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            sessionCapabilities: { fork: {} },
          },
        };
      },
      async unstable_forkSession(params) {
        forkRequest = params as typeof forkRequest;
        return {
          sessionId: "forked-session",
          configOptions: [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "gpt-5",
              options: [{ value: "gpt-5", name: "GPT-5" }],
            },
          ],
        };
      },
      async newSession() {
        newSessionCalled = true;
        return { sessionId: "fresh-session" };
      },
      async prompt() {
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
        mcpServers: [],
        forkFromAcpSessionId: "parent-acp-session",
      } as never,
    });

    await session.init();
    await session.dispose();

    expect(session.acpSessionId).toBe("forked-session");
    expect(session.supportsSessionFork).toBe(true);
    expect(newSessionCalled).toBe(false);
    expect(forkRequest).toEqual({
      sessionId: "parent-acp-session",
      cwd: "/tmp/backchat-test",
      mcpServers: [],
    });
    expect(session.configOptions[0]?.currentValue).toBe("gpt-5");
  });

  it("captures and updates ACP session config options", async () => {
    let setConfigRequest:
      | { sessionId: string; configId: string; value: string }
      | undefined;
    const harness = createInMemoryAcpHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return {
          sessionId: "fresh-session",
          configOptions: [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "gpt-5-mini",
              options: [{ value: "gpt-5-mini", name: "GPT-5 mini" }],
            },
          ],
        };
      },
      async setSessionConfigOption(params) {
        setConfigRequest = params as typeof setConfigRequest;
        return {
          configOptions: [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "gpt-5",
              options: [{ value: "gpt-5", name: "GPT-5" }],
            },
          ],
        };
      },
      async prompt() {
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
        mcpServers: [],
      },
    });

    await session.init();

    expect(session.configOptions[0]?.currentValue).toBe("gpt-5-mini");

    const next = await session.setConfigOption("model", "gpt-5");
    await session.dispose();

    expect(setConfigRequest).toEqual({
      sessionId: "fresh-session",
      configId: "model",
      value: "gpt-5",
    });
    expect(next[0]?.currentValue).toBe("gpt-5");
    expect(session.configOptions[0]?.currentValue).toBe("gpt-5");
  });

  it("drains idle session state updates emitted during session startup", async () => {
    const harness = createInMemoryAcpHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        await conn.sessionUpdate({
          sessionId: "fresh-session",
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: [
              {
                name: "review",
                description: "Review the current workspace",
              },
            ],
          },
        });
        return { sessionId: "fresh-session" };
      },
      async prompt() {
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
        mcpServers: [],
      },
    });

    await session.init();
    const pending = session.drainPendingEvents();
    await session.dispose();

    expect(pending).toEqual([
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "review",
            description: "Review the current workspace",
          },
        ],
      },
    ]);
    expect(session.drainPendingEvents()).toEqual([]);
  });

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

  it("sends structured prompt content blocks unchanged", async () => {
    let sentPrompt: unknown;
    const harness = createInMemoryAcpHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { promptCapabilities: { image: true } },
        };
      },
      async newSession() {
        return { sessionId: "fresh-session" };
      },
      async prompt(params) {
        sentPrompt = params.prompt;
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
        mcpServers: [],
      },
    });

    await session.init();
    const blocks: ContentBlock[] = [
      { type: "text", text: "compare these" },
      {
        type: "image",
        mimeType: "image/png",
        data: "iVBORw0KGgo=",
        uri: "file:///tmp/screenshot.png",
      },
      {
        type: "resource_link",
        uri: "file:///tmp/spec.md",
        name: "spec.md",
        mimeType: "text/markdown",
        size: 123,
      },
    ];
    for await (const _ of session.prompt(blocks)) {
      // drain
    }
    await session.dispose();

    expect(sentPrompt).toEqual(blocks);
    expect(session.promptCapabilities.image).toBe(true);
  });

  it("does not synthesize tool calls for client terminal callbacks", async () => {
    const harness = createInMemoryAcpHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "fresh-session" };
      },
      async prompt(params) {
        const terminal = await conn.createTerminal({
          sessionId: params.sessionId,
          command: "/bin/zsh",
          args: ["-lc", "pwd"],
          cwd: "/tmp/backchat-test",
        });
        await terminal.waitForExit();
        await terminal.currentOutput();
        await terminal.release();
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "done" },
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
        mcpServers: [],
        clientCallbacks: {
          async createTerminal() {
            return { terminalId: "term-test" };
          },
          async waitForTerminalExit() {
            return { exitCode: 0, signal: null };
          },
          async terminalOutput() {
            return {
              output: "/tmp/backchat-test\n",
              truncated: false,
              exitStatus: { exitCode: 0, signal: null },
            };
          },
          async releaseTerminal() {
            return {};
          },
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("pwd")) {
      events.push(event);
    }
    await session.dispose();

    expect(
      events.filter(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          ((event as { sessionUpdate?: string }).sessionUpdate === "tool_call" ||
            (event as { sessionUpdate?: string }).sessionUpdate === "tool_call_update"),
      ),
    ).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "done" },
      }),
    );
  });

  it("routes permission callbacks through the broker without synthesizing transcript events", async () => {
    const permissionRequests: unknown[] = [];
    const harness = createInMemoryAcpHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "fresh-session" };
      },
      async prompt(params) {
        await conn.requestPermission({
          sessionId: params.sessionId,
          toolCall: {
            toolCallId: "tool-shell",
            title: "Run shell command",
            kind: "execute",
            status: "pending",
          },
          options: [
            {
              optionId: "allow-once",
              name: "Allow once",
              kind: "allow_once",
            },
          ],
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
        mcpServers: [],
        clientCallbacks: {
          async requestPermission(params) {
            permissionRequests.push(params);
            return {
              outcome: {
                outcome: "selected",
                optionId: "allow-once",
              },
            };
          },
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("run it")) {
      events.push(event);
    }
    await session.dispose();

    expect(permissionRequests).toHaveLength(1);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "requestPermission" }),
    );
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

function createChildThatExitsOnFirstPrompt(): ChildHandle {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let stdoutController: ReadableStreamDefaultController<Uint8Array>;
  let resolveExit!: (result: { code: number | null; signal: string | null }) => void;
  const exited = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) => {
      resolveExit = resolve;
    },
  );
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      stdoutController = controller;
    },
  });
  let buffered = "";
  let exitedAlready = false;

  const respond = (id: number | string, result: unknown) => {
    stdoutController.enqueue(
      encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`),
    );
  };

  return {
    stdin: new WritableStream<Uint8Array>({
      write(chunk) {
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as {
            id?: number | string;
            method?: string;
          };
          if (message.id === undefined) continue;
          if (message.method === "initialize") {
            respond(message.id, { protocolVersion: PROTOCOL_VERSION });
          } else if (message.method === "session/new") {
            respond(message.id, { sessionId: "first-prompt-exit" });
          } else if (message.method === "session/prompt") {
            exitedAlready = true;
            resolveExit({ code: 1, signal: null });
            throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
          }
        }
      },
    }),
    stdout,
    stderr: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    exited,
    async kill() {
      if (!exitedAlready) {
        exitedAlready = true;
        resolveExit({ code: 0, signal: "SIGTERM" });
      }
      try {
        stdoutController.close();
      } catch {
        // The protocol stream may already have closed it.
      }
    },
  };
}
