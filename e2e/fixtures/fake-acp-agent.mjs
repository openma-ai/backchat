#!/usr/bin/env node
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
} from "../../packages/acp/node_modules/@agentclientprotocol/sdk/dist/acp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { Readable, Writable } from "node:stream";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const fakeAgentName = process.env.BACKCHAT_FAKE_AGENT_NAME ?? "fake-acp-agent";
const fakeAgentTitle = process.env.BACKCHAT_FAKE_AGENT_TITLE ?? "Fake ACP Agent";
const fakeAgentVersion = process.env.BACKCHAT_FAKE_AGENT_VERSION ?? "0.0.0-e2e";
const authStatePath = process.env.BACKCHAT_FAKE_AUTH_STATE;
const expiredAuthMessage = "Your access token could not be refreshed. Please sign in again.";

async function authState() {
  return authStatePath ? readFile(authStatePath, "utf8") : "configured";
}

async function recordAuthEvent(event) {
  if (authStatePath) await appendFile(`${authStatePath}.events.jsonl`, `${JSON.stringify(event)}\n`);
}

async function requireFixtureAuth() {
  if (authStatePath && await authState() === "expired") {
    throw RequestError.authRequired({ message: expiredAuthMessage });
  }
}

class FakeAcpAgent {
  constructor(connection) {
    this.connection = connection;
    this.sessions = new Map();
    this.directories = new Map();
    this.modes = new Map();
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
      ...(authStatePath ? { authMethods: [{ id: "e2e-login", name: "Test sign in" }] } : {}),
      agentCapabilities: {
        loadSession: true,
        ...(process.env.BACKCHAT_FAKE_CAPTURE_PROMPT ? {promptCapabilities:{image:true}} : {}),
        sessionCapabilities: {
          ...(process.env.BACKCHAT_FAKE_ADDITIONAL_DIRECTORIES === "1" ? { additionalDirectories: {} } : {}),
          resume: {},
        },
      },
    };
  }

  async newSession(params) {
    await requireFixtureAuth();
    const sessionId = `fake-acp-${Date.now().toString(36)}`;
    this.sessions.set(sessionId, params.mcpServers ?? []);
    this.directories.set(sessionId, params.cwd);
    await recordAuthEvent({ method: "session/new", sessionId });
    if (process.env.BACKCHAT_FAKE_CURSOR !== "1") return { sessionId };
    this.modes.set(sessionId, "agent");
    return {
      sessionId,
      modes: cursorModes("agent"),
      configOptions: cursorConfigOptions("agent"),
    };
  }

  async loadSession(params) {
    await requireFixtureAuth();
    this.sessions.set(params.sessionId, params.mcpServers ?? []);
    this.directories.set(params.sessionId, params.cwd);
    await recordAuthEvent({ method: "session/load", sessionId: params.sessionId });
    return {};
  }

  async resumeSession(params) {
    await requireFixtureAuth();
    this.sessions.set(params.sessionId, params.mcpServers ?? []);
    this.directories.set(params.sessionId, params.cwd);
    await recordAuthEvent({ method: "session/resume", sessionId: params.sessionId });
    return {};
  }

  async prompt(params) {
    if (!this.sessions.has(params.sessionId)) {
      throw new Error(`unknown fake session: ${params.sessionId}`);
    }
    if (process.env.BACKCHAT_FAKE_CAPTURE_PROMPT) await appendFile(process.env.BACKCHAT_FAKE_CAPTURE_PROMPT, JSON.stringify(params.prompt)+"\n");
    const promptText = params.prompt
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
    await recordAuthEvent({ method: "session/prompt", sessionId: params.sessionId, text: promptText });
    if (await this.runCursorProbe(params.sessionId, promptText)) {
      return { stopReason: "end_turn" };
    }
    if (authStatePath && await authState() !== "recovered" && promptText.includes("expire-codex-auth-e2e")) {
      await writeFile(authStatePath, "expired");
      // codex-acp 1.12 emits assistant text, then rejects the prompt with this
      // structured legacy error even when credentials were already configured.
      await this.connection.sessionUpdate({ sessionId: params.sessionId, update: {
        sessionUpdate: "agent_message_chunk", content: { type: "text", text: `${expiredAuthMessage}\n\n` },
      } });
      throw RequestError.internalError({
        message: expiredAuthMessage,
        codexErrorInfo: "unauthorized",
      });
    }
    if (promptText === "fail-after-accept-e2e") {
      throw new Error("Fake accepted prompt then failed");
    }
    if (promptText === "write-workspace-artifact-e2e") {
      await writeFile(join(this.directories.get(params.sessionId), "runner-output.txt"), "Created in the linked project");
    }
    if (promptText === "recover-offline-output-e2e") {
      const cwd = this.directories.get(params.sessionId);
      await appendFile(join(cwd, "offline-prompt-count.txt"), "started\n");
      await this.connection.sessionUpdate({ sessionId: params.sessionId, update: {
        sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Before disconnect. " },
      } });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await writeFile(join(cwd, "offline-output.txt"), "Completed while disconnected");
      await this.connection.sessionUpdate({ sessionId: params.sessionId, update: {
        sessionUpdate: "agent_message_chunk", content: { type: "text", text: "After disconnect." },
      } });
      return { stopReason: "end_turn" };
    }
    if (promptText === "approve-workspace-artifact-e2e") {
      const response = await this.connection.requestPermission({ sessionId: params.sessionId,
        toolCall: { toolCallId: "write-artifact", title: "Write approved artifact", kind: "edit", status: "pending" },
        options: [{ optionId: "write:once", name: "Write once", kind: "allow_once" }, { optionId: "write:reject", name: "Reject write", kind: "reject_once" }],
      });
      if (response.outcome.outcome !== "selected" || response.outcome.optionId !== "write:once") return { stopReason: "cancelled" };
      await writeFile(join(this.directories.get(params.sessionId), "approved-output.txt"), "Approved in the linked project");
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
    const reply = process.env.BACKCHAT_FAKE_SHORT_REPLY === "1"
      ? `[fake agent] ok: ${promptText.trim().slice(0, 40)}`
      : `Fake response saved for ${promptText}.`;
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: reply,
        },
      },
    });
    return { stopReason: "end_turn" };
  }

  async runCursorProbe(sessionId, promptText) {
    if (process.env.BACKCHAT_FAKE_CURSOR !== "1") return false;
    const cwd = this.directories.get(sessionId);
    const mode = this.modes.get(sessionId) ?? "agent";
    if (promptText === "cursor-direct-edit") {
      if (mode === "agent") {
        await writeFile(join(cwd, "CURSOR_DIRECT_EDIT.md"), "written by the edit tool\n");
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "edit-1",
            title: "Edit file",
            kind: "edit",
            status: "in_progress",
            rawInput: {},
          },
        });
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "edit-1",
            title: "Edit file",
            kind: "edit",
            status: "completed",
            rawInput: { path: "CURSOR_DIRECT_EDIT.md" },
            rawOutput: { path: "CURSOR_DIRECT_EDIT.md" },
          },
        });
        await this.say(sessionId, "edited");
        return true;
      }
      if (mode === "plan") {
        await this.connection.extMethod("cursor/create_plan", {
          toolCallId: "plan-1",
          name: "Edit plan",
          overview: "Would edit the file",
          plan: "# Edit\n\nDo not write yet.",
          todos: [{ id: "todo-1", content: "Edit the file", status: "pending" }],
        });
        await this.say(sessionId, "plan only");
        return true;
      }
      await this.say(sessionId, "ask mode refuses writes");
      return true;
    }
    if (promptText === "cursor-reject-shell") {
      const response = await this.connection.requestPermission({
        sessionId,
        toolCall: {
          toolCallId: "shell-1",
          title: "echo",
          kind: "execute",
          status: "pending",
        },
        options: [
          { optionId: "allow-once", name: "Allow", kind: "allow_once" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        ],
      });
      const allowed = response?.outcome?.outcome === "selected"
        && response.outcome.optionId === "allow-once";
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "shell-1",
          title: "echo",
          kind: "execute",
          status: "in_progress",
        },
      });
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "shell-1",
          title: "echo",
          kind: "execute",
          status: "completed",
          ...(allowed ? { rawOutput: "echo ok" } : {}),
        },
      });
      await this.say(sessionId, allowed ? "shell ok" : "shell denied");
      return true;
    }
    return false;
  }

  async say(sessionId, text) {
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });
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

  async authenticate(params) {
    if (authStatePath) {
      if (params.methodId !== "e2e-login") throw RequestError.invalidParams("Unknown fixture auth method");
      await writeFile(authStatePath, "recovered");
      await recordAuthEvent({ method: "authenticate", methodId: params.methodId });
    }
    return {};
  }

  async setSessionMode(params) {
    if (params?.sessionId && typeof params.modeId === "string") {
      this.modes.set(params.sessionId, params.modeId);
    }
    return {};
  }

  async setSessionConfigOption(params) {
    const mode = params?.configId === "mode" && typeof params.value === "string"
      ? params.value
      : this.modes.get(params?.sessionId) ?? "agent";
    if (params?.sessionId) this.modes.set(params.sessionId, mode);
    return { configOptions: cursorConfigOptions(mode) };
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

function cursorModeIds() {
  return (process.env.BACKCHAT_FAKE_CURSOR_MODES ?? "agent,plan,ask")
    .split(",")
    .map((mode) => mode.trim())
    .filter(Boolean);
}

function cursorModes(current) {
  const ids = cursorModeIds();
  const currentModeId = ids.includes(current) ? current : ids[0] ?? "agent";
  return {
    currentModeId,
    availableModes: ids.map((id) => ({ id, name: id })),
  };
}

function cursorConfigOptions(current) {
  const ids = cursorModeIds();
  const currentValue = ids.includes(current) ? current : ids[0] ?? "agent";
  return [{
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue,
    options: ids.map((id) => ({ value: id, name: id })),
  }];
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = ndJsonStream(input, output);

new AgentSideConnection((connection) => new FakeAcpAgent(connection), stream);
