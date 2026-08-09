#!/usr/bin/env node
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
} from "../../packages/acp/node_modules/@agentclientprotocol/sdk/dist/acp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { Readable, Writable } from "node:stream";

const fakeAgentName = process.env.BACKCHAT_FAKE_AGENT_NAME ?? "fake-acp-agent";
const fakeAgentTitle = process.env.BACKCHAT_FAKE_AGENT_TITLE ?? "Fake ACP Agent";
const fakeAgentVersion = process.env.BACKCHAT_FAKE_AGENT_VERSION ?? "0.0.0-e2e";

class FakeAcpAgent {
  constructor(connection) {
    this.connection = connection;
    this.sessions = new Map();
    /** sessionId -> resolver for a deliberately stalled turn. */
    this.pendingStalls = new Map();
  }

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: fakeAgentName,
        title: fakeAgentTitle,
        version: fakeAgentVersion,
      },
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: {
          resume: {},
        },
      },
    };
  }

  async newSession(params) {
    const sessionId = `fake-acp-${Date.now().toString(36)}`;
    this.sessions.set(sessionId, params.mcpServers ?? []);
    return { sessionId };
  }

  async loadSession(params) {
    this.sessions.set(params.sessionId, params.mcpServers ?? []);
    return {};
  }

  async resumeSession(params) {
    this.sessions.set(params.sessionId, params.mcpServers ?? []);
    return {};
  }

  async prompt(params) {
    if (!this.sessions.has(params.sessionId)) {
      throw new Error(`unknown fake session: ${params.sessionId}`);
    }
    const promptText = params.prompt
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
    if (promptText === "fail-after-accept-e2e") {
      throw new Error("Fake accepted prompt then failed");
    }
    if (promptText === "open-inline-preference-plugin-e2e") {
      await this.runInlinePreferencePlugin(params.sessionId);
      return { stopReason: "end_turn" };
    }
    if (promptText === "stall-until-cancelled-e2e") {
      // Hold the turn open so tests can observe a genuinely running composer.
      // Cancellation rejects the pending promise via cancel(), below.
      await new Promise((resolve) => {
        this.pendingStalls.set(params.sessionId, resolve);
      });
      return { stopReason: "cancelled" };
    }
    if (promptText === "cursor-plan-merge-e2e") {
      await this.runCursorPlanMerge();
    }
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `Fake response saved for ${promptText}.`,
        },
      },
    });
    return { stopReason: "end_turn" };
  }

  async runCursorPlanMerge() {
    await this.connection.extMethod("cursor/update_todos", {
      toolCallId: "cursor-todos-replace",
      merge: false,
      todos: [
        { id: "todo-1", content: "Audit inputs", status: "in_progress" },
        { id: "todo-2", content: "Wire outputs", status: "in_progress" },
      ],
    });
    await this.connection.extMethod("cursor/update_todos", {
      toolCallId: "cursor-todos-merge",
      merge: true,
      todos: [
        { id: "todo-1", content: "Audit inputs", status: "completed" },
        { id: "todo-3", content: "Verify replay", status: "cancelled" },
      ],
    });
  }

  async runInlinePreferencePlugin(sessionId) {
    const servers = this.sessions.get(sessionId) ?? [];
    const server = servers.find((entry) =>
      typeof entry.command === "string" &&
      entry.name?.includes("inline-preference-app"),
    );
    if (!server) {
      throw new Error("OpenMA did not inject the inline-preference-app MCP server");
    }

    const client = new Client(
      { name: "fake-acp-plugin-e2e", version: "0.0.0" },
      {
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": {
              mimeTypes: ["text/html;profile=mcp-app"],
            },
          },
        },
      },
    );
    await client.connect(new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: {
        ...getDefaultEnvironment(),
        ...Object.fromEntries((server.env ?? []).map(({ name, value }) => [name, value])),
      },
      stderr: "pipe",
    }));
    try {
      const listed = await client.listTools();
      const tool = listed.tools.find((entry) => entry.name === "open_preference_picker");
      if (!tool) throw new Error("inline-preference-app tool was not listed");
      const rawInput = {
        topic: "旅行计划",
        format: "简洁清单",
        detail: 3,
      };
      const toolCallId = `plugin-e2e-${Date.now().toString(36)}`;
      const toolName = `mcp__inline-preference-app__${tool.name}`;
      const meta = {
        ...(tool._meta ?? {}),
        mcp_server_name: server.name,
      };
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          title: tool.title ?? tool.name,
          toolName,
          status: "in_progress",
          rawInput,
          _meta: meta,
        },
      });
      const result = await client.callTool({
        name: tool.name,
        arguments: rawInput,
      });
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          title: tool.title ?? tool.name,
          toolName,
          status: "completed",
          rawInput,
          rawOutput: result,
          _meta: meta,
        },
      });
    } finally {
      await client.close();
    }
  }

  async authenticate() {
    return {};
  }

  async setSessionMode() {
    return {};
  }

  async cancel(params) {
    const stall = params?.sessionId
      ? this.pendingStalls.get(params.sessionId)
      : undefined;
    if (stall) {
      this.pendingStalls.delete(params.sessionId);
      stall();
    }
    return;
  }
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = ndJsonStream(input, output);

new AgentSideConnection((connection) => new FakeAcpAgent(connection), stream);
