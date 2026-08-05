/** Cursor ACP extension request shape verified against the 2026.07.23 CLI. */
import { defineHarnessFixture } from "./types";

export const CURSOR_2026_07_23_FIXTURE = defineHarnessFixture({
  metadata: {
    fixtureVersion: 2,
    harness: "cursor",
    harnessVersion: "2026.07.23",
    source: "https://cursor.com/docs/cli/acp",
  },
  setup: {
    sessionReady: {
      type: "session.ready",
      session_id: "fixture-cursor",
      acp_session_id: "acp-fixture-cursor",
      agent_id: "cursor",
      cwd: "/work",
      protocol_version: 1,
      agent_capabilities: {
        loadSession: true,
        promptCapabilities: { image: true, embeddedContext: true },
        mcpCapabilities: { http: true, sse: true },
        sessionCapabilities: { list: {} },
      },
      config_options: [{
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "auto",
        options: [{ value: "auto", name: "Auto" }],
      }],
    },
  },
  events: {
    commandsUpdated: {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "plan", description: "Create a plan" }],
    },
    modeUpdated: {
      sessionUpdate: "current_mode_update",
      currentModeId: "agent",
    },
    planCreated: {
      type: "acp.extension_request",
      method: "cursor/create_plan",
      params: {
        toolCallId: "cursor-plan-1",
        name: "Audit event boundaries",
        overview: "Preserve plan documents and task state.",
        plan: "# Audit event boundaries\n\nInspect inputs, outputs, and replay.",
        todos: [
          { id: "todo-1", content: "Audit inputs", status: "pending" },
          { id: "todo-2", content: "Wire outputs", status: "in_progress" },
        ],
        isProject: false,
        phases: [{
          name: "Adapter",
          todos: [
            { id: "todo-1", content: "Audit inputs", status: "pending" },
            { id: "todo-2", content: "Wire outputs", status: "in_progress" },
          ],
        }],
      },
    },
    todosReplaced: {
      type: "acp.extension_request",
      method: "cursor/update_todos",
      params: {
        toolCallId: "cursor-todos-replace",
        merge: false,
        todos: [
          { id: "todo-1", content: "Audit inputs", status: "in_progress" },
          { id: "todo-2", content: "Wire outputs", status: "in_progress" },
        ],
      },
    },
    todosMerged: {
      type: "acp.extension_request",
      method: "cursor/update_todos",
      params: {
        toolCallId: "cursor-todos-merge",
        merge: true,
        todos: [
          { id: "todo-1", content: "Audit inputs", status: "completed" },
          { id: "todo-3", content: "Verify replay", status: "cancelled" },
        ],
      },
    },
    sessionInfoUpdated: {
      sessionUpdate: "session_info_update",
      title: "Cursor event audit",
      updatedAt: "2026-07-23T00:00:00.000Z",
    },
    permissionRequested: {
      type: "acp.client_request",
      requestId: "cursor-permission-1",
      method: "session/request_permission",
      params: {
        sessionId: "acp-fixture-cursor",
        toolCall: {
          toolCallId: "cursor-shell-1",
          title: "Run shell command",
          kind: "execute",
          status: "pending",
        },
        options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" }],
      },
    },
    taskToolStarted: {
      sessionUpdate: "tool_call",
      toolCallId: "cursor-task-1",
      title: "Explore the event pipeline",
      kind: "other",
      status: "pending",
      rawInput: {
        _toolName: "task",
        description: "Explore the event pipeline",
        prompt: "Inspect all event boundaries",
        subagentType: "explore",
      },
    },
    taskStarted: {
      type: "acp.extension_request",
      method: "cursor/task",
      params: {
        toolCallId: "cursor-task-1",
        description: "Explore the event pipeline",
        subagentType: "explore",
        agentId: "cursor-child-7",
        durationMs: 1250,
      },
    },
  },
  coverage: {
    capability: {
      status: "setup_response",
      setupKey: "sessionReady",
      expectedCanonicalTypes: ["session.started"],
      guiSlot: "session capability gates",
      evidence: [{
        reference: "Cursor CLI 2026.07.23 dist-package/6447.index.js:1 initialize handler",
        claim: "initialize returns load/list, prompt, and MCP capabilities; setup separately returns configOptions.",
      }],
    },
    commands: {
      status: "emitted_event",
      eventKey: "commandsUpdated",
      expectedCanonicalTypes: ["command_catalog.updated"],
      guiSlot: "command palette",
      evidence: [{
        reference: "Cursor CLI 2026.07.23 dist-package/6447.index.js:1 available_commands_update emitter",
        claim: "Cursor emits the ACP available command catalog.",
      }],
    },
    modeConfig: {
      status: "emitted_event",
      eventKey: "modeUpdated",
      expectedCanonicalTypes: ["capability.updated"],
      guiSlot: "mode control",
      evidence: [{
        reference: "Cursor CLI 2026.07.23 dist-package/6447.index.js:1 current_mode_update emitter and session/set_config_option handler",
        claim: "Cursor emits current_mode_update; config changes return configOptions in the method response, not config_option_update.",
      }],
    },
    plan: {
      status: "emitted_event",
      eventKey: "planCreated",
      expectedCanonicalTypes: ["plan.updated"],
      guiSlot: "plan document + task list",
      evidence: [{
        reference: "Cursor CLI 2026.07.23 dist-package/6447.index.js:1 cursor/create_plan and cursor/update_todos emitters; https://cursor.com/docs/cli/acp#cursor-extension-methods",
        claim: "create_plan carries Markdown plus stable-id todos; update_todos merge=false replaces and merge=true merges by todo id.",
      }],
    },
    usage: {
      status: "not_emitted",
      evidence: [{
        reference: "Cursor CLI 2026.07.23 dist-package/6447.index.js emitter audit; dist-package/8096.index.js:2 schema only",
        claim: "usage_update exists only in the bundled generic ACP schema; no Cursor emitter was found.",
      }],
    },
    sessionStatus: {
      status: "emitted_event",
      eventKey: "sessionInfoUpdated",
      expectedCanonicalTypes: ["capability.updated"],
      guiSlot: "session title metadata (no running/idle claim)",
      evidence: [{
        reference: "Cursor CLI 2026.07.23 dist-package/6447.index.js:1 session_info_update emitter",
        claim: "Cursor emits session title metadata, but no structured running/idle lifecycle was found.",
      }],
    },
    terminalBackground: {
      status: "unverified",
      evidence: [{
        reference: "Cursor CLI 2026.07.23 dist-package/6447.index.js audit",
        claim: "ordinary terminal tools are visible, but no independently verifiable background lifecycle or terminal metadata contract was established.",
      }],
    },
    callback: {
      status: "emitted_event",
      eventKey: "permissionRequested",
      expectedCanonicalTypes: ["callback.requested"],
      guiSlot: "permission broker",
      evidence: [{
        reference: "Cursor CLI 2026.07.23 dist-package/6447.index.js:1 requestPermission call site",
        claim: "Cursor forwards tool approval through ACP requestPermission.",
      }],
    },
    nativeAgent: {
      status: "emitted_event",
      eventKey: "taskToolStarted",
      expectedCanonicalTypes: ["work_item.started"],
      guiSlot: "Agents",
      evidence: [{
        reference: "Cursor CLI 2026.07.23 dist-package/6447.index.js:1 cursor/task extension emitter",
        claim: "the task tool plus cursor/task response carries structured task and child-agent identity.",
      }],
    },
  },
});
