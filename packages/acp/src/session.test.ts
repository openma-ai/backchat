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
