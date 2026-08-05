/** pi-acp 0.0.33 structured built-in write tool update. */
import { defineHarnessFixture } from "./types";

export const PI_ACP_0_0_33_FIXTURE = defineHarnessFixture({
  metadata: {
    fixtureVersion: 2,
    harness: "pi-acp",
    harnessVersion: "0.0.33",
    source: "https://github.com/svkozak/pi-acp",
  },
  setup: {
    sessionReady: {
      type: "session.ready",
      session_id: "fixture-pi",
      acp_session_id: "acp-fixture-pi",
      agent_id: "pi-acp",
      cwd: "/work",
      protocol_version: 1,
      agent_capabilities: {
        loadSession: true,
        promptCapabilities: { image: true, audio: false, embeddedContext: false },
        mcpCapabilities: { http: false, sse: false },
        sessionCapabilities: { list: {}, delete: {} },
      },
      config_options: [{
        id: "thought_level",
        name: "Thinking level",
        category: "thought_level",
        type: "select",
        currentValue: "medium",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
        ],
      }],
    },
  },
  events: {
    commandsUpdated: {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "name", description: "Set the session name" }],
    },
    configUpdated: {
      sessionUpdate: "config_option_update",
      configOptions: [{
        id: "thought_level",
        name: "Thinking level",
        category: "thought_level",
        type: "select",
        currentValue: "high",
        options: [
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
        ],
      }],
    },
    sessionRunning: {
      sessionUpdate: "session_info_update",
      _meta: { piAcp: { queueDepth: 1, running: true } },
    },
    terminalCompleted: {
      sessionUpdate: "tool_call_update",
      toolCallId: "pi-bash-1",
      status: "completed",
      _meta: {
        terminal_output_delta: {
          terminal_id: "pi-bash-1",
          data: "tests passed\n",
        },
        terminal_exit: {
          terminal_id: "pi-bash-1",
          exit_code: 0,
        },
      },
    },
    permissionRequested: {
      type: "acp.client_request",
      requestId: "pi-permission-1",
      method: "session/request_permission",
      params: {
        sessionId: "acp-fixture-pi",
        toolCall: {
          toolCallId: "pi-ui-confirm-1",
          title: "Pi confirm",
          kind: "other",
          status: "pending",
          rawInput: { method: "confirm" },
        },
        options: [{ optionId: "yes", name: "Yes", kind: "allow_once" }],
      },
    },
    writeCompleted: {
      sessionUpdate: "tool_call_update",
      toolCallId: "pi-write-1",
      title: "write",
      kind: "edit",
      status: "completed",
      rawInput: {
        path: "/work/review.pptx",
        content: "deck",
      },
      rawOutput: "Wrote /work/review.pptx",
    },
  },
  coverage: {
    capability: {
      status: "setup_response",
      setupKey: "sessionReady",
      expectedCanonicalTypes: ["session.started"],
      guiSlot: "session capability gates",
      evidence: [{
        reference: "pi-acp@0.0.33 src/acp/agent.ts:237-276",
        claim: "initialize returns load, prompt, MCP, and list/delete session capabilities.",
      }],
    },
    commands: {
      status: "emitted_event",
      eventKey: "commandsUpdated",
      expectedCanonicalTypes: ["command_catalog.updated"],
      guiSlot: "command palette",
      evidence: [{
        reference: "pi-acp@0.0.33 src/acp/agent.ts:395-429",
        claim: "session creation asynchronously emits the full available_commands_update catalog.",
      }],
    },
    modeConfig: {
      status: "emitted_event",
      eventKey: "configUpdated",
      expectedCanonicalTypes: ["capability.updated"],
      guiSlot: "model/reasoning controls",
      evidence: [{
        reference: "pi-acp@0.0.33 src/acp/agent.ts:1389-1402",
        claim: "set mode/config emits current state through config_option_update.",
      }],
    },
    plan: {
      status: "not_emitted",
      evidence: [{
        reference: "pi-acp@0.0.33 src/acp source audit",
        claim: "no ACP plan or adapter plan extension emitter exists in this version.",
      }],
    },
    usage: {
      status: "not_emitted",
      evidence: [{
        reference: "pi-acp@0.0.33 src/acp source audit",
        claim: "no usage_update emitter exists in this version.",
      }],
    },
    sessionStatus: {
      status: "emitted_event",
      eventKey: "sessionRunning",
      expectedCanonicalTypes: ["session.running"],
      guiSlot: "session status + read-only queued placeholder",
      evidence: [{
        reference: "pi-acp@0.0.33 src/acp/session.ts:472-486, 850-864",
        claim: "prompt start/settle emits piAcp.running and queueDepth through session_info_update; queueDepth is provider-owned observability, not an editable OpenMA prompt queue.",
      }],
    },
    terminalBackground: {
      status: "emitted_event",
      eventKey: "terminalCompleted",
      expectedCanonicalTypes: ["tool.completed"],
      guiSlot: "Tool terminal output (not a background claim)",
      evidence: [{
        reference: "pi-acp@0.0.33 src/acp/session.ts:421-468",
        claim: "Bash tool updates carry terminal output delta and exit metadata; they do not assert background execution.",
      }],
    },
    callback: {
      status: "emitted_event",
      eventKey: "permissionRequested",
      expectedCanonicalTypes: ["callback.requested"],
      guiSlot: "permission broker",
      evidence: [{
        reference: "pi-acp@0.0.33 src/acp/session.ts:950-968",
        claim: "extension UI confirmation delegates to ACP requestPermission.",
      }],
    },
    nativeAgent: {
      status: "not_emitted",
      evidence: [{
        reference: "pi-acp@0.0.33 src/acp source audit",
        claim: "no structured Pi native-subagent lifecycle is emitted by this adapter version.",
      }],
    },
  },
});
