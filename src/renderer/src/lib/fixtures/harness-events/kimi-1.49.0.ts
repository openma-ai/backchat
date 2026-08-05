/** Kimi CLI 1.49.0 stable background notification message format. */
import { defineHarnessFixture } from "./types";

export const KIMI_1_49_0_FIXTURE = defineHarnessFixture({
  metadata: {
    fixtureVersion: 2,
    harness: "kimi",
    harnessVersion: "1.49.0",
    source: "https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html",
  },
  setup: {
    sessionReady: {
      type: "session.ready",
      session_id: "fixture-kimi",
      acp_session_id: "acp-fixture-kimi",
      agent_id: "kimi-acp",
      cwd: "/work",
      protocol_version: 1,
      agent_capabilities: {
        loadSession: true,
        promptCapabilities: { embeddedContext: true, image: true, audio: false },
        mcpCapabilities: { http: true, sse: false },
        sessionCapabilities: { list: {}, resume: {} },
      },
      modes: {
        availableModes: [{
          id: "default",
          name: "Default",
          description: "The default mode.",
        }],
        currentModeId: "default",
      },
    },
  },
  events: {
    commandsUpdated: {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "help", description: "Show help" }],
    },
    planUpdated: {
      sessionUpdate: "plan",
      entries: [{
        content: "Build the project",
        priority: "medium",
        status: "in_progress",
      }],
    },
    permissionRequested: {
      type: "acp.client_request",
      requestId: "kimi-permission-1",
      method: "session/request_permission",
      params: {
        sessionId: "acp-fixture-kimi",
        toolCall: {
          toolCallId: "kimi-tool-1",
          title: "Run command",
          kind: "execute",
          status: "pending",
        },
        options: [{ optionId: "approve", name: "Approve once", kind: "allow_once" }],
      },
    },
    backgroundCompleted: {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text:
          "[Notification] Background task completed: build project\n"
          + "Task ID: b1234567\n"
          + "Status: completed\n"
          + "Description: build project",
      },
    },
    backgroundTimedOut: {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text:
          "[Notification] Background task timed out: wait for service\n"
          + "Task ID: b7654321\n"
          + "Status: failed (Finished at: 2026-08-05 19:00:00, Duration: 30s)\n"
          + "Description: wait for service\n"
          + "Terminal reason: timed_out\n"
          + "Exit code: 124\n"
          + "Failure reason: Command timed out after 30s",
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
        reference: "Kimi CLI@1.49.0 src/kimi_cli/acp/server.py:96-116",
        claim: "initialize returns load, prompt, MCP, and list/resume capabilities.",
      }],
    },
    commands: {
      status: "emitted_event",
      eventKey: "commandsUpdated",
      expectedCanonicalTypes: ["command_catalog.updated"],
      guiSlot: "command palette",
      evidence: [{
        reference: "Kimi CLI@1.49.0 src/kimi_cli/acp/server.py:181-198",
        claim: "new session emits available_commands_update from the slash-command registry.",
      }],
    },
    modeConfig: {
      status: "setup_response",
      setupKey: "sessionReady",
      expectedCanonicalTypes: ["session.started"],
      guiSlot: "legacy mode/model controls",
      evidence: [{
        reference: "Kimi CLI@1.49.0 src/kimi_cli/acp/server.py:199-216",
        claim: "new session returns modes/models, but no configOptions or config_option_update.",
      }],
    },
    plan: {
      status: "emitted_event",
      eventKey: "planUpdated",
      expectedCanonicalTypes: ["plan.updated"],
      guiSlot: "plan/task list",
      evidence: [{
        reference: "Kimi CLI@1.49.0 src/kimi_cli/acp/session.py:556-584",
        claim: "TodoDisplayBlock is converted to an ACP plan; PlanDisplay is ignored.",
      }],
    },
    usage: {
      status: "not_emitted",
      evidence: [{
        reference: "Kimi CLI@1.49.0 src/kimi_cli/acp source audit",
        claim: "no usage_update emitter exists in this version.",
      }],
    },
    sessionStatus: {
      status: "not_emitted",
      evidence: [{
        reference: "Kimi CLI@1.49.0 src/kimi_cli/acp source audit",
        claim: "no structured session running/idle status emitter exists.",
      }],
    },
    terminalBackground: {
      status: "emitted_event",
      eventKey: "backgroundCompleted",
      expectedCanonicalTypes: ["work_item.completed"],
      guiSlot: "Background activity",
      evidence: [{
        reference: "Kimi CLI@1.49.0 src/kimi_cli/background/manager.py:487-560; src/kimi_cli/acp/session.py:366-372",
        claim: "terminal task notifications are rendered with stable title, Task ID, Status, Description, terminal reason/exit/failure fields and forwarded as one agent_message_chunk; no structured start/progress event exists.",
      }],
    },
    callback: {
      status: "emitted_event",
      eventKey: "permissionRequested",
      expectedCanonicalTypes: ["callback.requested"],
      guiSlot: "permission broker",
      evidence: [{
        reference: "Kimi CLI@1.49.0 src/kimi_cli/acp/session.py:475-523",
        claim: "ApprovalRequest is forwarded through ACP request_permission.",
      }],
    },
    nativeAgent: {
      status: "not_emitted",
      evidence: [{
        reference: "Kimi CLI@1.49.0 src/kimi_cli/acp/session.py:203, 292",
        claim: "SubagentEvent is explicitly ignored by the ACP session loop.",
      }],
    },
  },
});
