/** OpenCode 1.18.13 Task tool result with native child-session metadata. */
import { defineHarnessFixture } from "./types";

export const OPENCODE_1_18_13_FIXTURE = defineHarnessFixture({
  metadata: {
    fixtureVersion: 3,
    harness: "opencode",
    harnessVersion: "1.18.13",
    source: "https://github.com/anomalyco/opencode/releases/tag/v1.18.13",
  },
  setup: {
    sessionReady: {
      type: "session.ready",
      session_id: "fixture-opencode",
      acp_session_id: "acp-fixture-opencode",
      agent_id: "opencode",
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
        currentValue: "anthropic/claude",
        options: [{ value: "anthropic/claude", name: "Claude" }],
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
      used: 3_000,
      size: 200_000,
      cost: { amount: 0.03, currency: "USD" },
    },
    todoWriteStarted: {
      sessionUpdate: "tool_call",
      toolCallId: "opencode-todos-1",
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
      toolCallId: "opencode-shell-1",
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
      requestId: "opencode-permission-1",
      method: "session/request_permission",
      params: {
        sessionId: "acp-fixture-opencode",
        toolCall: {
          toolCallId: "opencode-shell-1",
          title: "Shell",
          kind: "execute",
          status: "pending",
        },
        options: [{ optionId: "once", name: "Allow once", kind: "allow_once" }],
      },
    },
    taskStarted: {
      sessionUpdate: "tool_call",
      toolCallId: "opencode-task-1",
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
      toolCallId: "opencode-task-1",
      title: "Inspect source handling",
      status: "completed",
      rawOutput: {
        output:
          '<task id="opencode-child-1" state="completed">'
          + "<task_result>Done</task_result></task>",
        metadata: {
          parentSessionId: "opencode-parent",
          sessionId: "opencode-child-1",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
        },
      },
    },
    resumedTaskStarted: {
      sessionUpdate: "tool_call",
      toolCallId: "opencode-task-resume",
      title: "Continue source handling",
      kind: "think",
      status: "pending",
      rawInput: {
        description: "Continue source handling",
        prompt: "Continue from the previous findings",
        subagent_type: "explore",
        task_id: "opencode-child-existing",
      },
    },
    backgroundTaskStarted: {
      sessionUpdate: "tool_call",
      toolCallId: "opencode-task-background",
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
      toolCallId: "opencode-task-background",
      title: "Audit event boundaries",
      status: "completed",
      rawOutput: {
        output:
          '<task id="opencode-child-background" state="running">'
          + "<summary>Background task started</summary>"
          + "<task_result>Working in the background.</task_result></task>",
        metadata: {
          parentSessionId: "opencode-parent",
          sessionId: "opencode-child-background",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
          background: true,
          jobId: "opencode-child-background",
        },
      },
    },
    backgroundTaskCompletedReplay: {
      sessionUpdate: "user_message_chunk",
      messageId: "opencode-background-complete",
      content: {
        type: "text",
        text:
          '<task id="opencode-child-background" state="completed">'
          + "<summary>Background task completed: Audit event boundaries</summary>"
          + "<task_result>Background audit complete.</task_result></task>",
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
        reference: "OpenCode@1.18.13 packages/opencode/src/acp/service.ts:103-130",
        claim: "initialize returns load, prompt, MCP, and close/fork/list/resume capabilities.",
      }],
    },
    commands: {
      status: "emitted_event",
      eventKey: "commandsUpdated",
      expectedCanonicalTypes: ["command_catalog.updated"],
      guiSlot: "command palette",
      evidence: [{
        reference: "OpenCode@1.18.13 packages/opencode/src/acp/service.ts:925-947",
        claim: "session setup emits available_commands_update from the directory snapshot.",
      }],
    },
    modeConfig: {
      status: "setup_response",
      setupKey: "sessionReady",
      expectedCanonicalTypes: ["session.started"],
      guiSlot: "mode/model/reasoning controls",
      evidence: [{
        reference: "OpenCode@1.18.13 packages/opencode/src/acp/service.ts:190-205, 894-904",
        claim: "new/load/set-config responses return complete configOptions; no config_option_update emitter exists.",
      }],
    },
    plan: {
      status: "emitted_event",
      eventKey: "todoWriteStarted",
      expectedCanonicalTypes: ["plan.updated"],
      guiSlot: "task list",
      evidence: [{
        reference: "OpenCode@1.18.13 packages/opencode/src/acp/event.ts:235-265; acp/tool.ts:125-137,265-273; tool/todo.ts:7-35",
        claim: "OpenCode emits no ACP plan update, but its exact todowrite tool call carries the complete typed todos snapshot in rawInput; the OpenMA adapter projects that structured tool snapshot as a replace-only canonical plan.updated.",
      }],
    },
    usage: {
      status: "emitted_event",
      eventKey: "usageUpdated",
      expectedCanonicalTypes: ["usage.updated"],
      guiSlot: "context usage",
      evidence: [{
        reference: "OpenCode@1.18.13 packages/opencode/src/acp/usage.ts:199-216",
        claim: "usage service emits used, size, and total session cost.",
      }],
    },
    sessionStatus: {
      status: "not_emitted",
      evidence: [{
        reference: "OpenCode@1.18.13 packages/opencode/src/acp source audit",
        claim: "no structured session_info_update running/idle status emitter exists.",
      }],
    },
    terminalBackground: {
      status: "emitted_event",
      eventKey: "shellCompleted",
      expectedCanonicalTypes: ["tool.completed"],
      guiSlot: "Tool content (not a background claim)",
      evidence: [{
        reference: "OpenCode@1.18.13 packages/opencode/src/acp/event.ts tool-part mapping",
        claim: "shell execution is emitted as ordinary ACP tool content; no structured background identity/lifecycle is asserted.",
      }],
    },
    callback: {
      status: "emitted_event",
      eventKey: "permissionRequested",
      expectedCanonicalTypes: ["callback.requested"],
      guiSlot: "permission broker",
      evidence: [{
        reference: "OpenCode@1.18.13 packages/opencode/src/acp/permission.ts:56-75",
        claim: "OpenCode permission events call ACP requestPermission.",
      }],
    },
    nativeAgent: {
      status: "emitted_event",
      eventKey: "taskStarted",
      expectedCanonicalTypes: ["work_item.started"],
      guiSlot: "Agents",
      evidence: [{
        reference: "OpenCode@1.18.13 packages/opencode/src/tool/task.ts:43-62,136-195,216-347",
        claim: "Task background is optional (omission means foreground), task_id resumes a stable child session, and rawOutput metadata carries parent/session/model/background/jobId.",
      }, {
        reference: "OpenCode@1.18.13 packages/opencode/src/acp/event.ts:68-113,131-198; service.ts:669-675",
        claim: "Live ACP forwards assistant deltas but not the synthetic user terminal envelope; session replay exposes that exact envelope as an audience=assistant user_message_chunk.",
      }],
    },
  },
});
