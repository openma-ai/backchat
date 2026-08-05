/** Captured from codex-acp 1.1.9 createSubAgentActivityUpdate(). */
import { defineHarnessFixture } from "./types";

export const CODEX_ACP_1_1_9_FIXTURE = defineHarnessFixture({
  metadata: {
    fixtureVersion: 1,
    harness: "@agentclientprotocol/codex-acp",
    harnessVersion: "1.1.9",
    source: "dist/index.js:createSubAgentActivityUpdate",
  },
  setup: {
    sessionReady: {
      type: "session.ready",
      session_id: "fixture-codex",
      acp_session_id: "acp-fixture-codex",
      agent_id: "codex-acp",
      cwd: "/work",
      protocol_version: 1,
      supports_steering: true,
      agent_capabilities: {
        loadSession: true,
        promptCapabilities: { embeddedContext: true, image: true },
        sessionCapabilities: {
          resume: {},
          list: {},
          close: {},
          delete: {},
          additionalDirectories: {},
        },
      },
      config_options: [{
        id: "collaboration_mode",
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
      availableCommands: [{
        name: "plan",
        description: "Turn plan mode on.",
        _meta: {
          commandAction: {
            kind: "setConfigOption",
            configId: "collaboration_mode",
            value: "plan",
            resetValue: "default",
            presentation: "state",
          },
        },
      }],
    },
    configUpdated: {
      sessionUpdate: "config_option_update",
      configOptions: [{
        id: "collaboration_mode",
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
        content: "Map the event pipeline",
        priority: "high",
        status: "in_progress",
      }],
    },
    usageUpdated: {
      sessionUpdate: "usage_update",
      used: 2_500,
      size: 128_000,
    },
    sessionRunning: {
      sessionUpdate: "session_info_update",
      _meta: {
        codex: {
          threadStatus: {
            type: "active",
            activeFlags: ["waitingOnApproval"],
          },
        },
      },
    },
    terminalCompleted: {
      sessionUpdate: "tool_call_update",
      toolCallId: "codex-terminal-1",
      status: "completed",
      _meta: {
        terminal_output_delta: {
          terminal_id: "codex-terminal-1",
          data: "tests passed\n",
        },
        terminal_exit: {
          terminal_id: "codex-terminal-1",
          exit_code: 0,
          signal: null,
        },
      },
    },
    permissionRequested: {
      type: "acp.client_request",
      requestId: "codex-permission-1",
      method: "session/request_permission",
      params: {
        sessionId: "acp-fixture-codex",
        toolCall: {
          toolCallId: "item-snapshot",
          kind: "execute",
          status: "pending",
          rawInput: null,
        },
        options: [{ optionId: "allow_once", name: "Allow Once", kind: "allow_once" }],
      },
    },
    subagentStarted: {
      sessionUpdate: "tool_call",
      toolCallId: "codex-subagent-start",
      title: "Start subagent project_map",
      kind: "other",
      status: "pending",
      rawInput: {
        agentThreadId: "codex-child-7",
        agentPath: "/root/project_map",
        activityKind: "started",
      },
      _meta: {
        codex: {
          subagent: {
            threadId: "codex-child-7",
            path: "/root/project_map",
            activity: "started",
          },
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
        reference: "@agentclientprotocol/codex-acp@1.1.9 src/CodexAcpServer.ts:220-260",
        claim: "initialize advertises prompt, session, MCP, provider, logout, and steering capabilities.",
      }],
    },
    commands: {
      status: "emitted_event",
      eventKey: "commandsUpdated",
      expectedCanonicalTypes: ["command_catalog.updated"],
      guiSlot: "command palette",
      evidence: [{
        reference: "@agentclientprotocol/codex-acp@1.1.9 src/__tests__/CodexACPAgent/data/available-commands-build-in.json",
        claim: "adapter emits available_commands_update with command-action metadata.",
      }],
    },
    modeConfig: {
      status: "emitted_event",
      eventKey: "configUpdated",
      expectedCanonicalTypes: ["capability.updated"],
      guiSlot: "mode/model/reasoning controls",
      evidence: [{
        reference: "@agentclientprotocol/codex-acp@1.1.9 src/CodexAcpServer.ts:1938-1948",
        claim: "session config changes emit a complete config_option_update.",
      }],
    },
    plan: {
      status: "emitted_event",
      eventKey: "planUpdated",
      expectedCanonicalTypes: ["plan.updated"],
      guiSlot: "plan/task list",
      evidence: [{
        reference: "@agentclientprotocol/codex-acp@1.1.9 src/CodexEventHandler.ts:700-715",
        claim: "Codex plan items emit ACP plan entries; Markdown deltas additionally emit plan_update.",
      }],
    },
    usage: {
      status: "emitted_event",
      eventKey: "usageUpdated",
      expectedCanonicalTypes: ["usage.updated"],
      guiSlot: "context usage",
      evidence: [{
        reference: "@agentclientprotocol/codex-acp@1.1.9 src/__tests__/CodexACPAgent/data/token-usage-session-update.json",
        claim: "adapter emits structured usage_update with used and size.",
      }],
    },
    sessionStatus: {
      status: "emitted_event",
      eventKey: "sessionRunning",
      expectedCanonicalTypes: ["session.running"],
      guiSlot: "session status",
      evidence: [{
        reference: "@agentclientprotocol/codex-acp@1.1.9 src/__tests__/CodexACPAgent/data/session-info-update-metadata.json",
        claim: "session_info_update carries structured codex.threadStatus active/idle/closed metadata.",
      }],
    },
    terminalBackground: {
      status: "emitted_event",
      eventKey: "terminalCompleted",
      expectedCanonicalTypes: ["tool.completed"],
      guiSlot: "Tool terminal output (not a background claim)",
      evidence: [{
        reference: "@agentclientprotocol/codex-acp@1.1.9 src/__tests__/CodexACPAgent/data/terminal-full-flow.json",
        claim: "terminal tool updates carry terminal_output_delta and terminal_exit metadata.",
      }],
    },
    callback: {
      status: "emitted_event",
      eventKey: "permissionRequested",
      expectedCanonicalTypes: ["callback.requested"],
      guiSlot: "permission broker",
      evidence: [{
        reference: "@agentclientprotocol/codex-acp@1.1.9 src/__tests__/CodexACPAgent/data/approval-command-allow-once.json",
        claim: "execution approval is requested through ACP requestPermission.",
      }],
    },
    nativeAgent: {
      status: "emitted_event",
      eventKey: "subagentStarted",
      expectedCanonicalTypes: ["work_item.started"],
      guiSlot: "Agents",
      evidence: [{
        reference: "@agentclientprotocol/codex-acp@1.1.9 src/__tests__/CodexACPAgent/data/subagent-activity-flow.json",
        claim: "collaboration activity emits structured codex.subagent thread/path/activity metadata.",
      }],
    },
  },
});
