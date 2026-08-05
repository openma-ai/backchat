/**
 * Versioned Claude extension envelopes used by adapter conformance tests.
 *
 * Sources:
 * - @agentclientprotocol/claude-agent-acp 0.64.2 emits opted-in SDK messages
 *   through `_claude/sdkMessage`.
 * - @anthropic-ai/claude-agent-sdk 0.3.220 `SDKTaskProgressMessage` in
 *   sdk.d.ts defines the message fields below. Its Monitor tool result and
 *   Claude Code 2.1.220 binary establish `taskId`, `local_bash`, the
 *   replace-semantics background level, and the task-notification wrapper.
 *   The Monitor contract and wrapper are unchanged in SDK/CLI 0.3.222 /
 *   2.1.222.
 */
import { defineHarnessFixture } from "./types";

export const CLAUDE_AGENT_ACP_0_64_2_FIXTURE = defineHarnessFixture({
  metadata: {
    fixtureVersion: 2,
    harness: "@agentclientprotocol/claude-agent-acp",
    harnessVersion: "0.64.2",
    upstream: "@anthropic-ai/claude-agent-sdk",
    upstreamVersion: "0.3.220",
    transport: "_claude/sdkMessage",
  },
  setup: {
    sessionReady: {
      type: "session.ready",
      session_id: "fixture-claude",
      acp_session_id: "acp-fixture-claude",
      agent_id: "claude-acp",
      cwd: "/work",
      protocol_version: 1,
      agent_capabilities: {
        loadSession: true,
        promptCapabilities: { image: true, embeddedContext: true },
        mcpCapabilities: { http: true, sse: true },
        sessionCapabilities: {
          additionalDirectories: {},
          close: {},
          delete: {},
          fork: {},
          list: {},
          resume: {},
        },
      },
      supports_session_fork: true,
      supports_steering: true,
      config_options: [{
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "default",
        options: [
          { value: "default", name: "Default" },
          { value: "plan", name: "Plan" },
        ],
      }],
    },
  },
  events: {
    commandsUpdated: {
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "compact", description: "Compact conversation context" },
      ],
    },
    configUpdated: {
      sessionUpdate: "config_option_update",
      configOptions: [{
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "plan",
        options: [
          { value: "default", name: "Default" },
          { value: "plan", name: "Plan" },
        ],
      }],
    },
    planUpdated: {
      sessionUpdate: "plan",
      entries: [{
        content: "Audit renderer event handling",
        priority: "medium",
        status: "in_progress",
      }],
    },
    usageUpdated: {
      sessionUpdate: "usage_update",
      used: 1_234,
      size: 200_000,
      cost: { amount: 0.0123, currency: "USD" },
    },
    sessionInfoUpdated: {
      sessionUpdate: "session_info_update",
      title: "Claude event audit",
      updatedAt: "2026-08-05T00:00:00.000Z",
    },
    permissionRequested: {
      type: "acp.client_request",
      requestId: "claude-permission-1",
      method: "session/request_permission",
      params: {
        sessionId: "acp-fixture-claude",
        toolCall: {
          toolCallId: "toolu-permission",
          title: "Bash",
          kind: "execute",
          status: "pending",
          rawInput: { command: "pnpm test" },
        },
        options: [{ optionId: "allow_once", name: "Allow", kind: "allow_once" }],
      },
    },
    subagentTaskStarted: {
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-claude-progress",
        message: {
          type: "system",
          subtype: "task_started",
          task_id: "agent-task-42",
          tool_use_id: "toolu-agent-parent",
          description: "Audit renderer event handling",
          subagent_type: "Explore",
          task_type: "local_agent",
          prompt: "Trace all structured event boundaries",
          uuid: "00000000-0000-4000-8000-000000000041",
          session_id: "sdk-claude-progress",
        },
      },
    },
    subagentTaskProgress: {
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-claude-progress",
        message: {
          type: "system",
          subtype: "task_progress",
          task_id: "agent-task-42",
          tool_use_id: "toolu-agent-parent",
          description: "Audit renderer event handling",
          subagent_type: "Explore",
          usage: {
            total_tokens: 1234,
            tool_uses: 7,
            duration_ms: 8400,
          },
          last_tool_name: "Grep",
          summary: "Located the adapter boundary",
          uuid: "00000000-0000-4000-8000-000000000042",
          session_id: "sdk-claude-progress",
        },
      },
    },
    subagentMessage: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Child located the canonical boundary." },
      _meta: {
        claudeCode: {
          parentToolUseId: "toolu-agent-parent",
        },
      },
    },
    subagentTaskCompleted: {
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-claude-progress",
        message: {
          type: "system",
          subtype: "task_notification",
          task_id: "agent-task-42",
          tool_use_id: "toolu-agent-parent",
          status: "completed",
          output_file: "/tmp/agent-task-42.output",
          summary: "Agent completed",
          usage: {
            total_tokens: 1234,
            tool_uses: 7,
            duration_ms: 8400,
          },
          uuid: "00000000-0000-4000-8000-000000000043",
          session_id: "sdk-claude-progress",
        },
      },
    },
    backgroundTaskProgress: {
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-claude-progress",
        message: {
          type: "system",
          subtype: "task_progress",
          task_id: "background-task-7",
          tool_use_id: "toolu-background-parent",
          description: "Build release artifacts",
          usage: {
            total_tokens: 0,
            tool_uses: 3,
            duration_ms: 5100,
          },
          last_tool_name: "Bash",
          summary: "Bundling renderer",
          uuid: "00000000-0000-4000-8000-000000000007",
          session_id: "sdk-claude-progress",
        },
      },
    },
    monitorToolCompleted: {
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu-monitor-parent",
      status: "completed",
      _meta: {
        claudeCode: {
          toolName: "Monitor",
          toolResponse: {
            taskId: "monitor-task-9",
            timeoutMs: 300_000,
            persistent: false,
          },
        },
      },
    },
    monitorTaskStarted: {
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-claude-progress",
        message: {
          type: "system",
          subtype: "task_started",
          task_id: "monitor-task-9",
          tool_use_id: "toolu-monitor-parent",
          description: "Watch deployment status",
          task_type: "local_bash",
          uuid: "00000000-0000-4000-8000-000000000091",
          session_id: "sdk-claude-progress",
        },
      },
    },
    backgroundTasksWithMonitor: {
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-claude-progress",
        message: {
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [{
            task_id: "monitor-task-9",
            task_type: "local_bash",
            description: "Watch deployment status",
          }],
          uuid: "00000000-0000-4000-8000-000000000092",
          session_id: "sdk-claude-progress",
        },
      },
    },
    backgroundTasksEmpty: {
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-claude-progress",
        message: {
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [],
          uuid: "00000000-0000-4000-8000-000000000093",
          session_id: "sdk-claude-progress",
        },
      },
    },
    monitorTaskCompleted: {
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-claude-progress",
        message: {
          type: "system",
          subtype: "task_notification",
          task_id: "monitor-task-9",
          tool_use_id: "toolu-monitor-parent",
          status: "completed",
          output_file: "/tmp/monitor-task-9.output",
          summary: "Monitor exited with code 0",
          uuid: "00000000-0000-4000-8000-000000000094",
          session_id: "sdk-claude-progress",
        },
      },
    },
    monitorDelivery: {
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-claude-progress",
        message: {
          type: "user",
          origin: { kind: "task-notification" },
          message: {
            role: "user",
            content:
              "<task-notification>\n"
              + "<task-id>monitor-task-9</task-id>\n"
              + "<summary>Monitor event: \"Watch deployment status\"</summary>\n"
              + "<event>deployment failed</event>\n"
              + "If this event is something the user would act on now, send a notification.\n"
              + "</task-notification>",
          },
          uuid: "00000000-0000-4000-8000-000000000095",
          session_id: "sdk-claude-progress",
        },
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
        reference: "@agentclientprotocol/claude-agent-acp@0.64.2 dist/acp-agent.js:687-735",
        claim: "initialize returns prompt/MCP/load/auth/session capabilities and the steering extension.",
      }],
    },
    commands: {
      status: "emitted_event",
      eventKey: "commandsUpdated",
      expectedCanonicalTypes: ["command_catalog.updated"],
      guiSlot: "command palette",
      evidence: [{
        reference: "@agentclientprotocol/claude-agent-acp@0.64.2 dist/acp-agent.js:3785-3798",
        claim: "sendAvailableCommandsUpdate emits the complete available_commands_update catalog.",
      }],
    },
    modeConfig: {
      status: "emitted_event",
      eventKey: "configUpdated",
      expectedCanonicalTypes: ["capability.updated"],
      guiSlot: "mode/model/reasoning controls",
      evidence: [{
        reference: "@agentclientprotocol/claude-agent-acp@0.64.2 dist/acp-agent.js:3800-3810",
        claim: "adapter emits config_option_update after applying a session config value.",
      }],
    },
    plan: {
      status: "emitted_event",
      eventKey: "planUpdated",
      expectedCanonicalTypes: ["plan.updated"],
      guiSlot: "plan/task list",
      evidence: [{
        reference: "@agentclientprotocol/claude-agent-acp@0.64.2 dist/acp-agent.js:4300-4336",
        claim: "TaskCreated and TaskCompleted hooks emit ACP plan entries.",
      }],
    },
    usage: {
      status: "emitted_event",
      eventKey: "usageUpdated",
      expectedCanonicalTypes: ["usage.updated"],
      guiSlot: "context usage",
      evidence: [{
        reference: "@agentclientprotocol/claude-agent-acp@0.64.2 dist/acp-agent.js:2308-2324",
        claim: "result handling emits structured usage_update with context size and optional cost.",
      }],
    },
    sessionStatus: {
      status: "emitted_event",
      eventKey: "sessionInfoUpdated",
      expectedCanonicalTypes: ["capability.updated"],
      guiSlot: "session title metadata (no running/idle claim)",
      evidence: [{
        reference: "@agentclientprotocol/claude-agent-acp@0.64.2 dist/acp-agent.js:799-833",
        claim: "turn-end title polling emits session_info_update; it does not expose a remote running/idle status.",
      }],
    },
    terminalBackground: {
      status: "emitted_event",
      eventKey: "monitorTaskStarted",
      expectedCanonicalTypes: ["work_item.started"],
      guiSlot: "background/Monitor activity",
      evidence: [{
        reference: "@agentclientprotocol/claude-agent-acp@0.64.2 dist/acp-agent.js:1578-1584; @anthropic-ai/claude-agent-sdk@0.3.220 sdk.d.ts SDKTaskStartedMessage",
        claim: "opt-in _claude/sdkMessage exposes task lifecycle; local_bash alone does not distinguish Monitor from Bash.",
      }],
    },
    callback: {
      status: "emitted_event",
      eventKey: "permissionRequested",
      expectedCanonicalTypes: ["callback.requested"],
      guiSlot: "permission broker",
      evidence: [{
        reference: "@agentclientprotocol/claude-agent-acp@0.64.2 dist/acp-agent.js:3446-3465",
        claim: "tool permission requests are forwarded through ACP requestPermission.",
      }],
    },
    nativeAgent: {
      status: "emitted_event",
      eventKey: "subagentTaskStarted",
      expectedCanonicalTypes: ["work_item.started"],
      guiSlot: "Agents",
      evidence: [{
        reference: "@anthropic-ai/claude-agent-sdk@0.3.220 sdk.d.ts SDKTaskStartedMessage + claude-agent-acp _claude/sdkMessage opt-in",
        claim: "task_started with subagent_type provides structured native-agent identity and lifecycle start.",
      }, {
        reference: "@anthropic-ai/claude-agent-sdk@0.3.220 sdk.d.ts SDKTaskNotificationMessage",
        claim: "task_notification provides stable task_id/status/output_file/summary and may carry total_tokens/tool_uses/duration_ms usage even when no preceding task_progress was observed.",
      }],
    },
  },
});
