/** Kilo 7.4.20 Task tool result with native child-session metadata. */
import { defineHarnessFixture } from "./types";

export const KILO_7_4_20_FIXTURE = defineHarnessFixture({
  metadata: {
    fixtureVersion: 3,
    harness: "kilo",
    harnessVersion: "7.4.20",
    source: "https://github.com/Kilo-Org/kilocode/releases/tag/v7.4.20",
  },
  setup: {
    sessionReady: {
      type: "session.ready",
      session_id: "fixture-kilo",
      acp_session_id: "acp-fixture-kilo",
      agent_id: "kilo",
      cwd: "/work",
      protocol_version: 1,
      supports_session_fork: true,
      agent_capabilities: {
        loadSession: true,
        promptCapabilities: { embeddedContext: true, image: true },
        mcpCapabilities: { http: true, sse: true },
        sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} },
      },
      config_options: [{
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "kilo/auto",
        options: [{ value: "kilo/auto", name: "Kilo Auto" }],
      }],
    },
  },
  events: {
    commandsUpdated: {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "review", description: "Review changes" }],
    },
    usageUpdated: {
      sessionUpdate: "usage_update",
      used: 2_800,
      size: 200_000,
      cost: { amount: 0.028, currency: "USD" },
    },
    todoWriteStarted: {
      sessionUpdate: "tool_call",
      toolCallId: "kilo-todos-1",
      title: "todowrite",
      kind: "other",
      status: "pending",
      rawInput: {
        todos: [
          { content: "Inspect adapter", status: "completed", priority: "high" },
          { content: "Persist canonical plan", status: "in_progress", priority: "medium" },
        ],
      },
    },
    shellCompleted: {
      sessionUpdate: "tool_call_update",
      toolCallId: "kilo-shell-1",
      title: "Shell",
      kind: "execute",
      status: "completed",
      content: [{
        type: "content",
        content: { type: "text", text: "tests passed" },
      }],
      rawOutput: "tests passed",
    },
    permissionRequested: {
      type: "acp.client_request",
      requestId: "kilo-permission-1",
      method: "session/request_permission",
      params: {
        sessionId: "acp-fixture-kilo",
        toolCall: {
          toolCallId: "kilo-shell-1",
          title: "Shell",
          kind: "execute",
          status: "pending",
        },
        options: [{ optionId: "once", name: "Allow once", kind: "allow_once" }],
      },
    },
    taskStarted: {
      sessionUpdate: "tool_call",
      toolCallId: "kilo-task-1",
      title: "Inspect source handling",
      kind: "think",
      status: "pending",
      rawInput: {
        description: "Inspect source handling",
        prompt: "Trace the source pipeline",
        subagent_type: "explore",
      },
    },
    taskCompleted: {
      sessionUpdate: "tool_call_update",
      toolCallId: "kilo-task-1",
      title: "Inspect source handling",
      status: "completed",
      rawOutput: {
        output:
          '<task id="kilo-child-1" state="completed">'
          + "<task_result>Done</task_result></task>",
        metadata: {
          parentSessionId: "kilo-parent",
          sessionId: "kilo-child-1",
          model: { providerID: "kilo", modelID: "auto" },
          variant: "high",
        },
      },
    },
    resumedTaskStarted: {
      sessionUpdate: "tool_call",
      toolCallId: "kilo-task-resume",
      title: "Continue source handling",
      kind: "think",
      status: "pending",
      rawInput: {
        description: "Continue source handling",
        prompt: "Continue from the previous findings",
        subagent_type: "explore",
        task_id: "kilo-child-existing",
      },
    },
    backgroundTaskStarted: {
      sessionUpdate: "tool_call",
      toolCallId: "kilo-task-background",
      title: "Audit event boundaries",
      kind: "think",
      status: "pending",
      rawInput: {
        description: "Audit event boundaries",
        prompt: "Inspect the event pipeline",
        subagent_type: "explore",
        background: true,
      },
    },
    backgroundTaskRunning: {
      sessionUpdate: "tool_call_update",
      toolCallId: "kilo-task-background",
      title: "Audit event boundaries",
      status: "completed",
      rawOutput: {
        output:
          '<task id="kilo-child-background" state="running">'
          + "<summary>Background task started</summary>"
          + "<task_result>Working in the background.</task_result></task>",
        metadata: {
          parentSessionId: "kilo-parent",
          sessionId: "kilo-child-background",
          model: { providerID: "kilo", modelID: "auto" },
          variant: "high",
          background: true,
          jobId: "kilo-child-background",
        },
      },
    },
    backgroundTaskFailedReplay: {
      sessionUpdate: "user_message_chunk",
      messageId: "kilo-background-failed",
      content: {
        type: "text",
        text:
          '<task id="kilo-child-background" state="error">'
          + "<summary>Background task failed: Audit event boundaries</summary>"
          + '<task_error>Audit failed. This subagent session can be resumed: '
          + 'call the task tool again with task_id="kilo-child-background" and a prompt '
          + "describing how to continue or recover. Its prior context is preserved."
          + "</task_error></task>",
        annotations: { audience: ["assistant"] },
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
        reference: "Kilo Code@7.4.20 packages/opencode/src/acp/service.ts:104-132",
        claim: "initialize returns load, prompt, MCP, and close/fork/list/resume capabilities.",
      }],
    },
    commands: {
      status: "emitted_event",
      eventKey: "commandsUpdated",
      expectedCanonicalTypes: ["command_catalog.updated"],
      guiSlot: "command palette",
      evidence: [{
        reference: "Kilo Code@7.4.20 packages/opencode/src/acp/service.ts:878-900",
        claim: "session setup emits available_commands_update from the directory snapshot.",
      }],
    },
    modeConfig: {
      status: "setup_response",
      setupKey: "sessionReady",
      expectedCanonicalTypes: ["session.started"],
      guiSlot: "mode/model/reasoning controls",
      evidence: [{
        reference: "Kilo Code@7.4.20 packages/opencode/src/acp/service.ts:190-206, 847-858",
        claim: "new/load/set-config responses return complete configOptions; no config_option_update emitter exists.",
      }],
    },
    plan: {
      status: "emitted_event",
      eventKey: "todoWriteStarted",
      expectedCanonicalTypes: ["plan.updated"],
      guiSlot: "task list",
      evidence: [{
        reference: "Kilo Code@7.4.20 packages/opencode/src/acp/event.ts:235-265; acp/tool.ts:125-137,268-276; tool/todo.ts:9-65",
        claim: "Kilo emits no ACP plan update, but its exact todowrite tool call carries the complete typed todos snapshot in rawInput; the OpenMA adapter projects that structured tool snapshot as a replace-only canonical plan.updated.",
      }],
    },
    usage: {
      status: "emitted_event",
      eventKey: "usageUpdated",
      expectedCanonicalTypes: ["usage.updated"],
      guiSlot: "context usage",
      evidence: [{
        reference: "Kilo Code@7.4.20 packages/opencode/src/acp/usage.ts:196-213",
        claim: "usage service emits used, size, and total session cost.",
      }],
    },
    sessionStatus: {
      status: "not_emitted",
      evidence: [{
        reference: "Kilo Code@7.4.20 packages/opencode/src/acp source audit",
        claim: "no structured session_info_update running/idle status emitter exists.",
      }],
    },
    terminalBackground: {
      status: "emitted_event",
      eventKey: "shellCompleted",
      expectedCanonicalTypes: ["tool.completed"],
      guiSlot: "Tool content (not a background claim)",
      evidence: [{
        reference: "Kilo Code@7.4.20 packages/opencode/src/acp/event.ts tool-part mapping",
        claim: "shell execution is emitted as ordinary ACP tool content; no structured background identity/lifecycle is asserted.",
      }],
    },
    callback: {
      status: "emitted_event",
      eventKey: "permissionRequested",
      expectedCanonicalTypes: ["callback.requested"],
      guiSlot: "permission broker",
      evidence: [{
        reference: "Kilo Code@7.4.20 packages/opencode/src/acp/permission.ts:50-72",
        claim: "Kilo permission events call ACP requestPermission.",
      }],
    },
    nativeAgent: {
      status: "emitted_event",
      eventKey: "taskStarted",
      expectedCanonicalTypes: ["work_item.started"],
      guiSlot: "Agents",
      evidence: [{
        reference: "Kilo Code@7.4.20 packages/opencode/src/tool/task.ts:53-100,147-233,271-430",
        claim: "Task background is optional (omission means foreground), task_id resumes a stable child session, and rawOutput metadata carries parent/session/model/variant/background/jobId.",
      }, {
        reference: "Kilo Code@7.4.20 packages/opencode/src/acp/event.ts:68-113,131-198; service.ts:670-676",
        claim: "Live ACP forwards assistant deltas but not the synthetic user terminal envelope; session replay exposes that exact envelope as an audience=assistant user_message_chunk.",
      }],
    },
  },
});
