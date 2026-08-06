/** @moonshot-ai/kimi-code 0.33.0 native `kimi acp` wire evidence. */
import { defineHarnessFixture } from "./types";

export const KIMI_CODE_0_33_0_FIXTURE = defineHarnessFixture({
  metadata: {
    fixtureVersion: 3,
    harness: "kimi-code",
    harnessVersion: "0.33.0",
    distribution: "@moonshot-ai/kimi-code",
    entrypoint: "kimi acp",
    source:
      "artifacts/harness-feature-matrix-staging/live-traces/kimi-final-response.json",
  },
  setup: {
    sessionReady: {
      type: "session.ready",
      session_id: "fixture-kimi-code",
      acp_session_id: "acp-fixture-kimi-code",
      agent_id: "kimi-code-acp",
      cwd: "/work",
      protocol_version: 1,
      agent_info: { name: "Kimi Code CLI", version: "0.33.0" },
      supports_session_fork: true,
      supports_session_close: true,
      supports_session_resume: true,
      supports_additional_directories: true,
      agent_capabilities: {
        loadSession: true,
        promptCapabilities: {
          embeddedContext: true,
          image: true,
          audio: false,
        },
        mcpCapabilities: { http: true, sse: true },
        sessionCapabilities: {
          list: {},
          resume: {},
          close: {},
          delete: {},
          fork: {},
          additionalDirectories: {},
        },
        auth: { logout: {} },
      },
      config_options: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "__kimi_env_model__",
          options: [{
            value: "__kimi_env_model__",
            name: "DeepSeek V4 Flash",
          }],
        },
        {
          id: "thinking",
          name: "Thinking",
          category: "thought_level",
          type: "select",
          currentValue: "on",
          options: [
            { value: "off", name: "Thinking Off" },
            { value: "on", name: "Thinking On" },
          ],
        },
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          currentValue: "default",
          options: [
            { value: "default", name: "Default" },
            { value: "plan", name: "Plan" },
            { value: "auto", name: "Auto" },
            { value: "yolo", name: "YOLO" },
          ],
        },
      ],
      modes: {
        currentModeId: "default",
        availableModes: [
          {
            id: "default",
            name: "Default",
            description: "Manual approvals; tools execute normally.",
          },
          {
            id: "plan",
            name: "Plan",
            description: "Read-only planning; no tool execution.",
          },
          {
            id: "auto",
            name: "Auto",
            description: "Auto-approve safe operations.",
          },
          {
            id: "yolo",
            name: "YOLO",
            description: "Auto-approve everything.",
          },
        ],
      },
    },
  },
  events: {
    commandsUpdated: {
      sessionUpdate: "available_commands_update",
      availableCommands: [
        {
          name: "compact",
          description: "Compact the conversation context",
          input: { hint: "<optional custom summarization instructions>" },
        },
        { name: "status", description: "Show current session status" },
        { name: "usage", description: "Show session token usage" },
        { name: "mcp", description: "Show MCP server status" },
        { name: "tasks", description: "List background tasks" },
        { name: "help", description: "Show available ACP commands" },
      ],
    },
    planUpdated: {
      sessionUpdate: "plan",
      entries: [{
        content: "Build the project",
        priority: "medium",
        status: "in_progress",
      }],
    },
    usageUpdated: {
      sessionUpdate: "usage_update",
      used: 4_096,
      size: 1_000_000,
    },
    sessionTitleUpdated: {
      sessionUpdate: "session_info_update",
      title: "Reply with exactly BACKCHAT_HARNESS_LIVE_OK and nothing else.",
    },
    permissionRequested: {
      type: "acp.client_request",
      requestId: "kimi-code-permission-1",
      method: "session/request_permission",
      params: {
        sessionId: "acp-fixture-kimi-code",
        toolCall: {
          toolCallId: "0:kimi-code-tool-1",
          title: "Bash",
          kind: "execute",
          status: "pending",
        },
        options: [
          {
            optionId: "approve_once",
            name: "Approve once",
            kind: "allow_once",
          },
          {
            optionId: "approve_always",
            name: "Approve for this session",
            kind: "allow_always",
          },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      },
    },
    agentToolStarted: {
      sessionUpdate: "tool_call",
      toolCallId: "0:call_00_Gh7aAoJCOQW1D8nqLIjB7191",
      title: "Agent",
      kind: "other",
      status: "pending",
      content: [{
        type: "content",
        content: { type: "text", text: "" },
      }],
    },
    agentToolInputReady: {
      sessionUpdate: "tool_call_update",
      toolCallId: "0:call_00_Gh7aAoJCOQW1D8nqLIjB7191",
      title: "Launching agent agent: Reply CHILD_OK",
      kind: "other",
      status: "in_progress",
      rawInput: {
        description: "Reply CHILD_OK",
        prompt: "Reply exactly with the single token CHILD_OK and nothing else.",
        subagent_type: "agent",
      },
    },
    agentToolCompleted: {
      sessionUpdate: "tool_call_update",
      toolCallId: "0:call_00_Gh7aAoJCOQW1D8nqLIjB7191",
      status: "completed",
      rawOutput:
        "agent_id: agent-0\nactual_subagent_type: agent\nstatus: completed\n\n[summary]\nCHILD_OK",
      content: [{
        type: "content",
        content: {
          type: "text",
          text:
            "agent_id: agent-0\nactual_subagent_type: agent\nstatus: completed\n\n[summary]\nCHILD_OK",
        },
      }],
    },
  },
  coverage: {
    capability: {
      status: "setup_response",
      setupKey: "sessionReady",
      expectedCanonicalTypes: ["session.started"],
      guiSlot: "session capability gates",
      evidence: [{
        reference:
          "@moonshot-ai/kimi-code@0.33.0 dist/main.mjs:340030-340061",
        claim:
          "initialize advertises load, list/resume/close/delete/fork/additional-directories, prompt, MCP HTTP/SSE, and logout capabilities.",
      }],
    },
    commands: {
      status: "emitted_event",
      eventKey: "commandsUpdated",
      expectedCanonicalTypes: ["command_catalog.updated"],
      guiSlot: "command palette",
      evidence: [{
        reference:
          "artifacts/harness-feature-matrix-staging/live-traces/kimi-final-response.json",
        claim:
          "A live kimi acp session emitted the complete available_commands_update catalog, including the six built-in commands represented here.",
      }],
    },
    modeConfig: {
      status: "setup_response",
      setupKey: "sessionReady",
      expectedCanonicalTypes: ["session.started"],
      guiSlot: "model, thinking, and mode controls",
      evidence: [{
        reference:
          "@moonshot-ai/kimi-code@0.33.0 dist/main.mjs:337677-337925",
        claim:
          "session setup returns configOptions for model, optional thinking, and the four-mode default/plan/auto/yolo catalog.",
      }],
    },
    plan: {
      status: "emitted_event",
      eventKey: "planUpdated",
      expectedCanonicalTypes: ["plan.updated"],
      guiSlot: "plan/task list",
      evidence: [{
        reference:
          "@moonshot-ai/kimi-code@0.33.0 dist/main.mjs:338220-338242",
        claim:
          "Todo-list display blocks are projected into standard ACP plan updates.",
      }],
    },
    usage: {
      status: "emitted_event",
      eventKey: "usageUpdated",
      expectedCanonicalTypes: ["usage.updated"],
      guiSlot: "parent usage/context",
      evidence: [{
        reference:
          "@moonshot-ai/kimi-code@0.33.0 dist/main.mjs:339719-339750",
        claim:
          "After a turn settles, kimi acp emits usage_update when the bound model has a known context size; cost is omitted.",
      }],
    },
    sessionStatus: {
      status: "emitted_event",
      eventKey: "sessionTitleUpdated",
      expectedCanonicalTypes: ["capability.updated"],
      guiSlot: "session title metadata",
      evidence: [{
        reference:
          "artifacts/harness-feature-matrix-staging/live-traces/kimi-final-response.json",
        claim:
          "The live session emitted session_info_update with title only; it did not report a structured running/idle state.",
      }],
    },
    terminalBackground: {
      status: "not_emitted",
      evidence: [{
        reference:
          "artifacts/harness-feature-matrix-staging/live-traces/kimi-native-agent.json",
        claim:
          "The live Agent invocation emitted ordinary turn-scoped tool_call/tool_call_update records, not a background work-item lifecycle.",
      }],
    },
    callback: {
      status: "emitted_event",
      eventKey: "permissionRequested",
      expectedCanonicalTypes: ["callback.requested"],
      guiSlot: "permission broker",
      evidence: [{
        reference:
          "@moonshot-ai/kimi-code@0.33.0 dist/main.mjs:338360-338451",
        claim:
          "Approval requests are forwarded through ACP session/request_permission with approve_once, approve_always, and reject options.",
      }],
    },
    nativeAgent: {
      status: "not_emitted",
      evidence: [{
        reference:
          "artifacts/harness-feature-matrix-staging/live-traces/kimi-native-agent.json",
        claim:
          "The live trace recorded nativeSignal=false: the Agent tool exposed no namespaced _meta or distinct child lifecycle, transcript, usage, or terminal event over ACP.",
      }],
    },
  },
});
