import { describe, expect, it } from "vitest";

import {
  attachOpenMAEvent,
  nativeAgentTranscriptToOpenMAEvent,
  nativeAgentUpdateToOpenMAEvent,
  runtimeMonitorEventToOpenMAEvent,
  runtimeWorkItemUpdateToOpenMAEvents,
  toOpenMAEvent,
} from "./openma-event.js";

const options = {
  occurredAt: "2026-08-04T10:00:00.000Z",
  harness: "claude-acp",
  adapter: "claude",
};

describe("SessionEventOut → OpenMA event boundary", () => {
  it("keeps an uncorrelated Monitor notification as a session event", () => {
    expect(runtimeMonitorEventToOpenMAEvent({
      description: "errors in deploy.log",
      text: "ERROR timeout",
    }, {
      sessionId: "sess-monitor",
      turnId: "turn-monitor",
      occurredAt: "2026-08-05T10:00:00.000Z",
      adapter: "claude",
    })).toMatchObject({
      type: "monitor.event",
      session_id: "sess-monitor",
      turn_id: "turn-monitor",
      data: {
        description: "errors in deploy.log",
        text: "ERROR timeout",
      },
    });
  });

  it("maps ACP v2 complete message and thought updates into canonical slots", () => {
    const message = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-v2",
      turn_id: "turn-v2",
      event: {
        sessionUpdate: "agent_message",
        messageId: "msg-v2",
        content: [{ type: "text", text: "complete answer" }],
      },
    }, options);
    const thought = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-v2",
      turn_id: "turn-v2",
      event: {
        sessionUpdate: "agent_thought",
        messageId: "thought-v2",
        content: [{ type: "text", text: "complete thought" }],
      },
    }, options);

    expect(message).toMatchObject({
      type: "agent.message",
      data: {
        content: [{ type: "text", text: "complete answer" }],
        message_id: "msg-v2",
      },
    });
    expect(thought).toMatchObject({
      type: "agent.thinking",
      data: {
        content: [{ type: "text", text: "complete thought" }],
        message_id: "thought-v2",
      },
    });
  });

  it("maps ACP v2 running and idle state updates to the session lifecycle", () => {
    const running = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-v2-state",
      turn_id: "turn-v2-state",
      event: { sessionUpdate: "state_update", state: "running" },
    }, options);
    const idle = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-v2-state",
      turn_id: "turn-v2-state",
      event: { sessionUpdate: "state_update", state: "idle" },
    }, options);

    expect(running).toMatchObject({
      type: "session.running",
      data: { state: "running" },
    });
    expect(idle).toMatchObject({
      type: "session.idle",
      data: { state: "idle" },
    });
  });

  it("maps ACP v2 tool content chunks to the existing tool progress slot", () => {
    const event = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-v2-tool",
      turn_id: "turn-v2-tool",
      event: {
        sessionUpdate: "tool_call_content_chunk",
        toolCallId: "tool-v2",
        content: { type: "text", text: "partial output" },
      },
    }, options);

    expect(event).toMatchObject({
      type: "tool.progress",
      data: {
        tool_call_id: "tool-v2",
        content: [{ type: "text", text: "partial output" }],
      },
    });
  });

  it("maps structured Pi warning notifications to canonical system notices", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-pi-notify",
      turn_id: "turn-pi-notify",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Model fallback engaged" },
        _meta: { piAcp: { notify: { level: "warning" } } },
      },
    }, {
      occurredAt: "2026-08-05T00:00:00.000Z",
      harness: "pi-acp",
      adapter: "pi",
    });

    expect(result).toMatchObject({
      type: "system.notice",
      data: {
        message: "Model fallback engaged",
        tone: "warning",
        adapter_meta: { piAcp: { notify: { level: "warning" } } },
      },
    });
  });

  it("promotes Codex message phase into harness-neutral canonical data", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-codex-phase",
      turn_id: "turn-codex-phase",
      event: {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-commentary",
        content: { type: "text", text: "Inspecting files" },
        _meta: { codex: { phase: "commentary" } },
      },
    }, {
      occurredAt: "2026-08-05T00:00:00.000Z",
      harness: "codex-acp",
      adapter: "codex",
    });

    expect(result).toMatchObject({
      type: "agent.message_chunk",
      data: {
        text: "Inspecting files",
        message_id: "message-commentary",
        phase: "commentary",
      },
    });
  });

  it("maps a reidentified runtime work item into canonical identity and lifecycle events", () => {
    const result = runtimeWorkItemUpdateToOpenMAEvents({
      id: "bash-task-1",
      previousId: "claude-bash:bash-call-1",
      toolCallId: "bash-call-1",
      kind: "bash",
      status: "running",
      title: "pnpm test --watch",
      command: "pnpm test --watch",
      canStop: true,
    }, {
      sessionId: "sess-1",
      turnId: "turn-1",
      occurredAt: options.occurredAt,
      adapter: "claude",
    });

    expect(result).toEqual([
      expect.objectContaining({
        type: "work_item.reidentified",
        session_id: "sess-1",
        turn_id: "turn-1",
        work_item_id: "bash-task-1",
        parent_id: "bash-call-1",
        data: { previous_work_item_id: "claude-bash:bash-call-1" },
      }),
      expect.objectContaining({
        type: "work_item.started",
        session_id: "sess-1",
        turn_id: "turn-1",
        work_item_id: "bash-task-1",
        parent_id: "bash-call-1",
        data: {
          kind: "bash",
          missing_terminal: false,
          title: "pnpm test --watch",
          command: "pnpm test --watch",
          can_stop: true,
        },
      }),
    ]);
  });

  it("maps runtime progress without restarting the work item lifecycle", () => {
    const result = runtimeWorkItemUpdateToOpenMAEvents({
      id: "background-task-7",
      toolCallId: "toolu-background-parent",
      kind: "other",
      phase: "progress",
      status: "running",
      title: "Build release artifacts",
      progress: {
        description: "Build release artifacts",
        lastToolName: "Bash",
        summary: "Bundling renderer",
        usage: {
          totalTokens: 0,
          toolUses: 3,
          durationMs: 5100,
        },
      },
    }, {
      sessionId: "sess-progress",
      turnId: "turn-progress",
      occurredAt: options.occurredAt,
      adapter: "claude",
    });

    expect(result).toEqual([
      expect.objectContaining({
        type: "work_item.progress",
        session_id: "sess-progress",
        turn_id: "turn-progress",
        work_item_id: "background-task-7",
        parent_id: "toolu-background-parent",
        data: {
          output: {
            description: "Build release artifacts",
            lastToolName: "Bash",
            summary: "Bundling renderer",
            usage: {
              totalTokens: 0,
              toolUses: 3,
              durationMs: 5100,
            },
          },
        },
      }),
    ]);
  });

  it("keeps terminal-only runtime work-item identity on the canonical terminal event", () => {
    const result = runtimeWorkItemUpdateToOpenMAEvents({
      id: "b1234567",
      kind: "other",
      status: "completed",
      title: "build project",
      canStop: false,
      result: { status: "completed" },
    }, {
      sessionId: "sess-kimi",
      turnId: "turn-notification",
      occurredAt: options.occurredAt,
      adapter: "kimi",
    });

    expect(result).toEqual([
      expect.objectContaining({
        type: "work_item.completed",
        work_item_id: "b1234567",
        source: { kind: "harness", harness: "kimi", adapter: "kimi" },
        data: {
          kind: "other",
          missing_terminal: false,
          title: "build project",
          result: { status: "completed" },
        },
      }),
    ]);
  });

  it("keeps an ACP update as an explicit raw event until an adapter maps it", () => {
    const update = {
      sessionUpdate: "future_background_event",
      taskId: "task-1",
      status: "running",
    };
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: update,
    }, options);

    expect(result).toMatchObject({
      schema_version: "oma.event.v1",
      type: "raw.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      source: { kind: "harness", harness: "claude-acp", adapter: "claude" },
      data: {
        kind: "raw",
        source: "acp",
        method: "session/update",
        event_type: "future_background_event",
        payload: update,
        reason: "unsupported",
      },
    });
  });

  it("retains an ACP extension notification as a vendor event", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        type: "acp.extension_notification",
        method: "_vendor.dev/background_progress",
        params: { taskId: "task-7", progress: 0.5 },
      },
    }, options);

    expect(result).toMatchObject({
      type: "vendor.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      raw: {
        kind: "raw",
        source: "acp",
        method: "session/update",
        event_type: "acp.extension_notification",
        payload: {
          type: "acp.extension_notification",
          method: "_vendor.dev/background_progress",
          params: { taskId: "task-7", progress: 0.5 },
        },
      },
      data: {
        kind: "vendor",
        harness: "claude-acp",
        namespace: "acp.extension_notification",
        name: "_vendor.dev/background_progress",
        data: { taskId: "task-7", progress: 0.5 },
      },
    });
  });

  it("retains an ACP extension request as a vendor event", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-cursor",
      turn_id: "turn-1",
      event: {
        type: "acp.extension_request",
        method: "cursor/task",
        params: {
          toolCallId: "task-call-1",
          agentId: "cursor-child-1",
          subagentType: "explore",
        },
      },
    }, { ...options, harness: "cursor", adapter: "cursor" });

    expect(result).toMatchObject({
      type: "vendor.event",
      session_id: "sess-cursor",
      turn_id: "turn-1",
      data: {
        kind: "vendor",
        harness: "cursor",
        namespace: "acp.extension_request",
        name: "cursor/task",
        correlation: {
          session_id: "sess-cursor",
          turn_id: "turn-1",
          work_item_id: "cursor-child-1",
          parent_id: "task-call-1",
        },
        data: {
          toolCallId: "task-call-1",
          agentId: "cursor-child-1",
          subagentType: "explore",
        },
      },
    });
  });

  it("maps Cursor's confirmed update-todos extension into the existing Plan slot", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-cursor",
      turn_id: "turn-1",
      event: {
        type: "acp.extension_request",
        method: "cursor/update_todos",
        params: {
          toolCallId: "todos-call-1",
          merge: true,
          todos: [
            { id: "todo-1", content: "Audit inputs", status: "completed" },
            { id: "todo-2", content: "Wire outputs", status: "in_progress" },
          ],
        },
      },
    }, { ...options, harness: "cursor", adapter: "cursor" });

    expect(result).toMatchObject({
      type: "plan.updated",
      session_id: "sess-cursor",
      turn_id: "turn-1",
      data: {
        representation: "items",
        plan_id: "cursor-todos",
        update_mode: "merge",
        entries: [
          {
            id: "todo-1",
            content: "Audit inputs",
            status: "completed",
          },
          {
            id: "todo-2",
            content: "Wire outputs",
            status: "in_progress",
          },
        ],
        adapter_meta: {
          method: "cursor/update_todos",
          toolCallId: "todos-call-1",
          merge: true,
        },
      },
    });
  });

  it("maps Cursor's create-plan extension request into the existing Plan slot", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-cursor",
      turn_id: "turn-1",
      event: {
        type: "acp.extension_request",
        method: "cursor/create_plan",
        params: {
          toolCallId: "plan-call-1",
          name: "Release",
          overview: "Ship safely",
          plan: "# Release\n\nShip safely",
          todos: [
            { id: "todo-1", content: "Run tests", status: "pending" },
          ],
          isProject: true,
        },
      },
    }, { ...options, harness: "cursor", adapter: "cursor" });

    expect(result).toMatchObject({
      type: "plan.updated",
      session_id: "sess-cursor",
      turn_id: "turn-1",
      data: {
        representation: "markdown",
        plan_id: "plan-call-1",
        document: {
          id: "plan-call-1",
          title: "Release",
          markdown: "# Release\n\nShip safely",
        },
        entries: [
          { id: "todo-1", content: "Run tests", status: "pending" },
        ],
        adapter_meta: {
          method: "cursor/create_plan",
          overview: "Ship safely",
          isProject: true,
        },
      },
    });
  });

  it("retains an unsupported MCP-over-ACP notification with its real ACP method", () => {
    const event = {
      type: "acp.mcp_notification",
      method: "mcp/message",
      params: {
        connectionId: "mcp-connection-1",
        method: "notifications/initialized",
      },
    };
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event,
    }, options);

    expect(result).toMatchObject({
      type: "raw.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      data: {
        kind: "raw",
        source: "acp",
        method: event.method,
        event_type: event.type,
        payload: event.params,
        reason: "unsupported",
      },
    });
  });

  it("maps official elicitation completion into the callback lifecycle slot", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-elicitation",
      turn_id: "turn-elicitation",
      event: {
        type: "acp.elicitation_complete",
        method: "elicitation/complete",
        params: { elicitationId: "release-channel" },
      },
    }, options);

    expect(result).toMatchObject({
      type: "callback.notification",
      session_id: "sess-elicitation",
      turn_id: "turn-elicitation",
      data: {
        method: "elicitation/complete",
        category: "elicitation",
        params: { elicitationId: "release-channel" },
      },
    });
  });

  it("maps a host permission response into a canonical user input event", () => {
    const event = toOpenMAEvent({
      type: "session.permission_response",
      session_id: "sess-permission",
      request_id: "perm-1",
      option_id: "allow-once",
      outcome: "selected",
    } as never, options);

    expect(event).toMatchObject({
      type: "user.permission_response",
      session_id: "sess-permission",
      source: { kind: "user" },
      data: {
        request_id: "perm-1",
        option_id: "allow-once",
        outcome: "selected",
      },
    });
  });

  it("maps a filesystem approval decision into a canonical user input event", () => {
    const event = toOpenMAEvent({
      type: "session.fs_write_response",
      session_id: "sess-filesystem",
      request_id: "fsw-1",
      path: "/tmp/outside/matrix-output.txt",
      outcome: "denied",
    } as never, options);

    expect(event).toMatchObject({
      type: "user.fs_write_response",
      session_id: "sess-filesystem",
      source: { kind: "user" },
      data: {
        request_id: "fsw-1",
        path: "/tmp/outside/matrix-output.txt",
        outcome: "denied",
      },
    });
  });

  it("maps a typed elicitation form response into a canonical user input event", () => {
    const event = toOpenMAEvent({
      type: "session.elicitation_response",
      session_id: "sess-elicitation-input",
      request_id: "elicit-1",
      action: "accept",
      content: { note: "ship it", retries: 3 },
    }, options);

    expect(event).toMatchObject({
      type: "user.elicitation_response",
      session_id: "sess-elicitation-input",
      source: { kind: "user" },
      data: {
        request_id: "elicit-1",
        action: "accept",
        content: { note: "ship it", retries: 3 },
      },
      raw: {
        kind: "raw",
        source: "transport",
        event_type: "elicitation_response",
      },
    });
  });

  it("preserves URL elicitation correlation in the canonical user decision", () => {
    const event = toOpenMAEvent({
      type: "session.elicitation_response",
      session_id: "sess-elicitation-url",
      request_id: "elicit-url-1",
      action: "accept",
      mode: "url",
      elicitation_id: "github-oauth-001",
    }, options);

    expect(event).toMatchObject({
      type: "user.elicitation_response",
      session_id: "sess-elicitation-url",
      source: { kind: "user" },
      data: {
        request_id: "elicit-url-1",
        action: "accept",
        mode: "url",
        elicitation_id: "github-oauth-001",
      },
    });
  });

  it("maps a command-palette selection into canonical user input without inventing an ACP method", () => {
    const event = toOpenMAEvent({
      type: "session.command_invoked",
      session_id: "sess-command",
      turn_id: "control-1",
      command: "goal",
      args: "pause",
      text: "/goal pause",
    } as never, options);

    expect(event).toMatchObject({
      type: "user.message",
      session_id: "sess-command",
      turn_id: "control-1",
      source: { kind: "user" },
      data: {
        input_kind: "command",
        command: "goal",
        args: "pause",
        text: "/goal pause",
      },
      raw: {
        kind: "raw",
        source: "transport",
        event_type: "command_invoked",
      },
    });
  });

  it.each([
    [
      "acp.client_request",
      "callback.requested",
      {
        type: "acp.client_request",
        requestId: "client-request-1",
        method: "session/request_permission",
        params: { toolCall: { toolCallId: "tool-1" }, options: [] },
      },
      {
        callback_id: "client-request-1",
        method: "session/request_permission",
        category: "permission",
        params: { toolCall: { toolCallId: "tool-1" }, options: [] },
      },
    ],
    [
      "acp.client_response",
      "callback.completed",
      {
        type: "acp.client_response",
        requestId: "client-request-2",
        method: "fs/read_text_file",
        result: { content: "hello" },
      },
      {
        callback_id: "client-request-2",
        method: "fs/read_text_file",
        category: "filesystem",
        result: { content: "hello" },
      },
    ],
    [
      "acp.client_error",
      "callback.failed",
      {
        type: "acp.client_error",
        requestId: "client-request-3",
        method: "terminal/output",
        error: { message: "unknown terminal" },
      },
      {
        callback_id: "client-request-3",
        method: "terminal/output",
        category: "terminal",
        error: { message: "unknown terminal" },
      },
    ],
    [
      "acp.client_notification",
      "callback.notification",
      {
        type: "acp.client_notification",
        method: "elicitation/complete",
        params: { elicitationId: "release-channel" },
      },
      {
        method: "elicitation/complete",
        category: "elicitation",
        params: { elicitationId: "release-channel" },
      },
    ],
  ])("maps %s into canonical %s audit facts", (_transportType, canonicalType, event, data) => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event,
    }, options);

    expect(result).toMatchObject({
      type: canonicalType,
      session_id: "sess-1",
      turn_id: "turn-1",
      data,
      raw: {
        kind: "raw",
        source: "acp",
        method: event.method,
        event_type: event.type,
        payload: event,
      },
    });
  });

  it("keeps an adapter extension callback lifecycle canonical without treating it as an ACP-native feature", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-cursor",
      turn_id: "turn-1",
      event: {
        type: "acp.client_response",
        requestId: "client-request-4",
        method: "cursor/ask_question",
        result: { answers: { framework: "React" } },
      },
    }, { ...options, harness: "cursor", adapter: "cursor" });

    expect(result).toMatchObject({
      type: "callback.completed",
      data: {
        callback_id: "client-request-4",
        method: "cursor/ask_question",
        category: "extension",
        result: { answers: { framework: "React" } },
      },
    });
  });

  it("maps native ACP message chunks while retaining the original payload", () => {
    const update = {
      sessionUpdate: "agent_message_chunk",
      _meta: { claudeCode: { parentToolUseId: "task-parent" } },
      content: { type: "text", text: "child output" },
    };
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: update,
    }, options);

    expect(result).toMatchObject({
      type: "agent.message_chunk",
      parent_id: "task-parent",
      data: { text: "child output" },
      raw: {
        payload: update,
        source: "acp",
      },
    });
  });

  it("preserves a non-text ACP message content block as a canonical agent message", () => {
    const content = {
      type: "image",
      data: "aW1hZ2U=",
      mimeType: "image/png",
      uri: "file:///tmp/generated.png",
      annotations: { audience: ["user"], priority: 0.8 },
      _meta: { "vendor.dev/imageId": "image-7" },
    };
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-image",
      turn_id: "turn-image",
      event: {
        sessionUpdate: "agent_message_chunk",
        messageId: "message-image-1",
        content,
        _meta: { "vendor.dev/phase": "result" },
      },
    }, options);

    expect(result).toMatchObject({
      type: "agent.message_chunk",
      session_id: "sess-image",
      turn_id: "turn-image",
      data: {
        message_id: "message-image-1",
        content,
        adapter_meta: { "vendor.dev/phase": "result" },
      },
    });
    expect(result?.type).not.toBe("raw.event");
  });

  it("lifts notification-scoped ACP metadata without mixing it into harness metadata", () => {
    const update = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "child output" },
      _meta: { claudeCode: { parentToolUseId: "task-parent" } },
      "_openma.acp.notification": {
        session_id: "sess-1",
        meta: {
          traceparent: "00-abc-def-01",
          "vendor.dev/notification": { sequence: 7 },
        },
      },
    };
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: update,
    }, options);

    expect(result).toMatchObject({
      type: "agent.message_chunk",
      data: {
        text: "child output",
        adapter_meta: {
          claudeCode: { parentToolUseId: "task-parent" },
          "acp.notification": {
            traceparent: "00-abc-def-01",
            "vendor.dev/notification": { sequence: 7 },
          },
        },
      },
      raw: { payload: update },
    });
  });

  it("maps ACP command and usage updates into canonical metadata events", () => {
    const commands = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "review" }],
      },
    }, options);
    const usage = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "usage_update",
        used: 12,
        size: 100,
      },
    }, options);

    expect(commands).toMatchObject({
      type: "command_catalog.updated",
      data: { commands: [{ name: "review" }] },
    });
    expect(usage).toMatchObject({
      type: "usage.updated",
      data: { used: 12, size: 100 },
    });
  });

  it("normalizes adapter terminal output and exit metadata into canonical tool lifecycle data", () => {
    const output = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "shell-1",
        _meta: {
          terminal_output: {
            terminal_id: "shell-1",
            data: "12 tests passed\n",
          },
        },
      },
    }, options);
    const exit = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "shell-1",
        _meta: {
          terminal_exit: {
            terminal_id: "shell-1",
            exit_code: 0,
            signal: null,
          },
        },
      },
    }, options);

    expect(output).toMatchObject({
      type: "tool.progress",
      data: {
        tool_call_id: "shell-1",
        output: {
          kind: "terminal",
          data: "12 tests passed\n",
          terminal_id: "shell-1",
          append: true,
        },
      },
      raw: { payload: expect.objectContaining({ sessionUpdate: "tool_call_update" }) },
    });
    expect(exit).toMatchObject({
      type: "tool.completed",
      data: {
        tool_call_id: "shell-1",
        status: "completed",
        terminal: {
          terminal_id: "shell-1",
          exit_code: 0,
          signal: null,
        },
      },
    });
  });

  it("normalizes Codex MCP progress metadata as append-only tool output", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "mcp-1",
        _meta: { mcp_output_delta: { data: "Reading result" } },
      },
    }, { ...options, harness: "codex-acp", adapter: "codex" });

    expect(result).toMatchObject({
      type: "tool.progress",
      data: {
        tool_call_id: "mcp-1",
        output: {
          kind: "mcp",
          data: "Reading result",
          append: true,
          separator: "\n",
        },
      },
    });
  });

  it("lifts Claude non-execution metadata into a canonical tool failure reason", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "shell-denied",
        status: "failed",
        _meta: {
          claudeCode: {
            toolName: "Bash",
            nonExecutionKind: "user-rejected",
            userFeedback: "Do not run the deployment command",
          },
        },
      },
    }, options);

    expect(result).toMatchObject({
      type: "tool.failed",
      data: {
        tool_call_id: "shell-denied",
        tool_name: "Bash",
        status: "failed",
        reason: "user-rejected",
        error: "Do not run the deployment command",
      },
    });
  });

  it("maps Codex thread status, archive, close, and retry errors into canonical session semantics", () => {
    const convert = (codex: Record<string, unknown>) => toOpenMAEvent({
      type: "session.event",
      session_id: "sess-codex",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "session_info_update",
        _meta: { codex },
      },
    }, { ...options, harness: "codex-acp", adapter: "codex" });

    expect(convert({ threadStatus: { type: "active" } })).toMatchObject({
      type: "session.running",
      data: { thread_status: { type: "active" } },
    });
    expect(convert({ threadStatus: { type: "idle" } })).toMatchObject({
      type: "session.idle",
      data: { thread_status: { type: "idle" } },
    });
    expect(convert({ archived: true })).toMatchObject({
      type: "capability.updated",
      data: { session_archived: true },
    });
    expect(convert({ closed: true })).toMatchObject({
      type: "session.terminated",
      data: { reason: "provider_closed" },
    });
    expect(convert({
      error: { message: "connection reset", willRetry: true, turnId: "turn-1" },
    })).toMatchObject({
      type: "session.running",
      data: {
        retrying: true,
        provider_error: { message: "connection reset", willRetry: true, turnId: "turn-1" },
      },
    });
  });

  it("maps Pi running metadata into canonical session lifecycle without dropping queue depth", () => {
    const convert = (running: boolean, queueDepth: number) => toOpenMAEvent({
      type: "session.event",
      session_id: "sess-pi",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "session_info_update",
        _meta: { piAcp: { running, queueDepth } },
      },
    }, { ...options, harness: "pi-acp", adapter: "pi" });

    expect(convert(true, 2)).toMatchObject({
      type: "session.running",
      data: {
        queue_depth: 2,
        adapter_meta: { piAcp: { running: true, queueDepth: 2 } },
      },
    });
    expect(convert(false, 0)).toMatchObject({
      type: "session.idle",
      data: {
        queue_depth: 0,
        adapter_meta: { piAcp: { running: false, queueDepth: 0 } },
      },
    });
  });

  it("normalizes ACP Markdown plan updates as canonical plan documents", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "plan_update",
        plan: {
          id: "plan-1",
          title: "Release",
          content: { markdown: "# Release\n\nShip it" },
        },
      },
    }, options);

    expect(result).toMatchObject({
      type: "plan.updated",
      data: {
        document: {
          id: "plan-1",
          title: "Release",
          markdown: "# Release\n\nShip it",
        },
      },
    });
  });

  it("normalizes the current ACP Markdown plan shape without losing planId", () => {
    const update = {
      sessionUpdate: "plan_update",
      plan: {
        type: "markdown",
        planId: "plan-markdown-1",
        content: "# Release\n\nShip it",
      },
    };
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: update,
    }, options);

    expect(result).toMatchObject({
      type: "plan.updated",
      data: {
        representation: "markdown",
        plan_id: "plan-markdown-1",
        document: {
          id: "plan-markdown-1",
          markdown: "# Release\n\nShip it",
        },
      },
      raw: { payload: update },
    });
  });

  it("normalizes the current ACP item plan shape with its identity", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "plan_update",
        plan: {
          type: "items",
          planId: "plan-items-1",
          entries: [{
            content: "Implement the adapter",
            priority: "high",
            status: "in_progress",
          }],
        },
      },
    }, options);

    expect(result).toMatchObject({
      type: "plan.updated",
      data: {
        representation: "items",
        plan_id: "plan-items-1",
        entries: [{
          content: "Implement the adapter",
          priority: "high",
          status: "in_progress",
        }],
      },
    });
  });

  it("retains a current ACP file plan as a structured canonical reference", () => {
    const update = {
      sessionUpdate: "plan_update",
      plan: {
        type: "file",
        planId: "plan-file-1",
        uri: "file:///repo/PLAN.md",
      },
    };
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: update,
    }, options);

    expect(result).toMatchObject({
      type: "plan.updated",
      data: {
        representation: "file",
        plan_id: "plan-file-1",
        document: {
          id: "plan-file-1",
          uri: "file:///repo/PLAN.md",
        },
      },
      raw: { payload: update },
    });
  });

  it("maps ACP plan removal to removal rather than completion", () => {
    const result = toOpenMAEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "plan_removed",
        planId: "plan-file-1",
      },
    }, options);

    expect(result).toMatchObject({
      type: "plan.removed",
      data: { plan_id: "plan-file-1" },
    });
  });

  it("records an injected steering input as a user fact instead of a completed turn", () => {
    const result = toOpenMAEvent({
      type: "session.steering",
      session_id: "sess-1",
      turn_id: "turn-steer",
      active_turn_id: "turn-active",
      text: "change direction",
      requested_delivery: "llm_boundary",
      effective_delivery: "llm_boundary",
      outcome: "injected",
    } as never, options);

    expect(result).toMatchObject({
      type: "user.message",
      session_id: "sess-1",
      turn_id: "turn-steer",
      source: { kind: "user" },
      data: {
        text: "change direction",
        active_turn_id: "turn-active",
        requested_delivery: "llm_boundary",
        effective_delivery: "llm_boundary",
        outcome: "injected",
      },
    });
    expect(result?.type).not.toBe("turn.completed");
  });

  it("retains initial configuration and negotiated capabilities on the canonical session start", () => {
    const configOptions = [{
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "sonnet",
      options: [{ value: "sonnet", name: "Sonnet" }],
    }];
    const modes = {
      currentModeId: "ask",
      availableModes: [
        { id: "ask", name: "Ask" },
        { id: "code", name: "Code" },
      ],
    };
    const result = toOpenMAEvent({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/repo",
      additional_directories: ["/repo/packages", "/repo/docs"],
      config_options: configOptions,
      modes,
      protocol_version: 1,
      agent_info: { name: "fixture-agent", version: "1.2.3" },
      agent_capabilities: {
        promptCapabilities: { image: true },
        sessionCapabilities: { resume: {}, close: {} },
      },
      initialize_meta: {
        steering: { supported: true },
        "vendor.dev/runtime": { build: "2026.08" },
      },
      session_setup_meta: {
        piAcp: { startupInfo: "Loaded AGENTS.md" },
      },
      supports_session_fork: true,
      supports_session_list: true,
      supports_session_delete: true,
      supports_session_resume: true,
      supports_session_close: true,
      supports_additional_directories: true,
      supports_logout: true,
      supports_providers: true,
      supports_nes: true,
      supports_steering: true,
    } as never, options);

    expect(result).toMatchObject({
      type: "session.started",
      data: {
        config_options: configOptions,
        additional_directories: ["/repo/packages", "/repo/docs"],
        modes,
        protocol_version: 1,
        agent_info: { name: "fixture-agent", version: "1.2.3" },
        agent_capabilities: {
          promptCapabilities: { image: true },
          sessionCapabilities: { resume: {}, close: {} },
        },
        adapter_meta: {
          steering: { supported: true },
          "vendor.dev/runtime": { build: "2026.08" },
        },
        session_setup_meta: {
          piAcp: { startupInfo: "Loaded AGENTS.md" },
        },
        capabilities: {
          session_fork: true,
          session_list: true,
          session_delete: true,
          session_resume: true,
          session_close: true,
          additional_directories: true,
          logout: true,
          providers: true,
          nes: true,
          steering: true,
        },
      },
    });
  });

  it("maps a user Stop request to user.interrupt", () => {
    const result = toOpenMAEvent({
      type: "session.cancel_requested",
      session_id: "sess-1",
      turn_id: "turn-1",
    }, options);

    expect(result).toMatchObject({
      type: "user.interrupt",
      session_id: "sess-1",
      turn_id: "turn-1",
      source: { kind: "user" },
      data: { reason: "user_stop" },
    });
  });

  it("maps the prompt cancellation acknowledgement to turn.cancelled", () => {
    const result = toOpenMAEvent({
      type: "session.cancelled",
      session_id: "sess-1",
      turn_id: "turn-1",
    }, options);

    expect(result).toMatchObject({
      type: "turn.cancelled",
      session_id: "sess-1",
      turn_id: "turn-1",
      data: { reason: "user_stop" },
    });
  });

  it("maps the ACP client's preemptive tool cancellation to tool.cancelled", () => {
    const result = toOpenMAEvent({
      type: "session.tool_cancelled",
      session_id: "sess-1",
      turn_id: "turn-1",
      tool_call_id: "tool-1",
      reason: "user_stop",
    } as never, options);

    expect(result).toMatchObject({
      type: "tool.cancelled",
      session_id: "sess-1",
      turn_id: "turn-1",
      source: { kind: "openma", adapter: "acp-client" },
      data: {
        tool_call_id: "tool-1",
        status: "cancelled",
        reason: "user_stop",
      },
    });
  });

  it("keeps prompt response stop reason, usage, and metadata on turn.completed", () => {
    const result = toOpenMAEvent({
      type: "session.complete",
      session_id: "sess-1",
      turn_id: "turn-1",
      stop_reason: "max_tokens",
      usage: {
        totalTokens: 120,
        inputTokens: 80,
        outputTokens: 40,
      },
      meta: { quota: { remaining: 7 } },
    }, options);

    expect(result).toMatchObject({
      type: "turn.completed",
      session_id: "sess-1",
      turn_id: "turn-1",
      data: {
        stop_reason: "max_tokens",
        usage: {
          totalTokens: 120,
          inputTokens: 80,
          outputTokens: 40,
        },
        adapter_meta: { quota: { remaining: 7 } },
      },
    });
  });

  it("maps native subagent lifecycle into WorkItem events", () => {
    const started = toOpenMAEvent({
      type: "session.native_subagent",
      session_id: "sess-1",
      provider: "claude",
      child_id: "agent-1",
      tool_call_id: "tool-1",
      task: "Inspect the repository",
      agent_type: "explore",
      status: "running",
    }, options);
    const completed = toOpenMAEvent({
      type: "session.native_subagent",
      session_id: "sess-1",
      provider: "claude",
      child_id: "agent-1",
      status: "complete",
      result: "done",
    }, { ...options, occurredAt: "2026-08-04T10:00:05.000Z" });

    expect(started).toMatchObject({
      type: "work_item.started",
      work_item_id: "agent-1",
      parent_id: "tool-1",
      data: { kind: "agent", title: "Inspect the repository" },
    });
    expect(completed).toMatchObject({
      type: "work_item.completed",
      work_item_id: "agent-1",
      data: { result: "done" },
    });
  });

  it("maps ACP terminal lifecycle into one canonical bash work item", () => {
    const started = toOpenMAEvent({
      type: "session.background_process",
      session_id: "sess-1",
      process_id: "term-1",
      seq: 1,
      phase: "started",
      command: "pnpm",
      args: ["test"],
      cwd: "/tmp/project",
    }, options);
    const output = toOpenMAEvent({
      type: "session.background_process",
      session_id: "sess-1",
      process_id: "term-1",
      seq: 2,
      phase: "output",
      output: "42 tests passed\n",
    }, options);
    const completed = toOpenMAEvent({
      type: "session.background_process",
      session_id: "sess-1",
      process_id: "term-1",
      seq: 3,
      phase: "completed",
      exit_code: 0,
      signal: null,
    }, { ...options, occurredAt: "2026-08-04T10:00:05.000Z" });

    expect(started).toMatchObject({
      event_id: "background-process:sess-1:term-1:1",
      type: "work_item.started",
      session_id: "sess-1",
      work_item_id: "term-1",
      seq: 1,
      data: {
        kind: "bash",
        title: "pnpm test",
        command: "pnpm",
        args: ["test"],
        cwd: "/tmp/project",
        can_stop: true,
      },
    });
    expect(output).toMatchObject({
      event_id: "background-process:sess-1:term-1:2",
      type: "work_item.output",
      work_item_id: "term-1",
      seq: 2,
      data: { output: "42 tests passed\n" },
    });
    expect(completed).toMatchObject({
      event_id: "background-process:sess-1:term-1:3",
      type: "work_item.completed",
      work_item_id: "term-1",
      seq: 3,
      data: { result: { exit_code: 0, signal: null } },
    });
  });

  it("preserves terminal failure and user-kill terminal outcomes", () => {
    const failed = toOpenMAEvent({
      type: "session.background_process",
      session_id: "sess-1",
      process_id: "term-failed",
      seq: 4,
      phase: "failed",
      exit_code: 2,
      signal: null,
    }, options);
    const killed = toOpenMAEvent({
      type: "session.background_process",
      session_id: "sess-1",
      process_id: "term-killed",
      seq: 5,
      phase: "killed",
      exit_code: null,
      signal: "SIGTERM",
      reason: "user_kill",
    }, options);

    expect(failed).toMatchObject({
      type: "work_item.failed",
      data: {
        error: "Process exited with code 2",
        result: { exit_code: 2, signal: null },
      },
    });
    expect(killed).toMatchObject({
      type: "work_item.killed",
      data: {
        reason: "user_kill",
        result: { exit_code: null, signal: "SIGTERM" },
      },
    });
  });

  it("does not invent a lifecycle when a native update has no status", () => {
    const result = toOpenMAEvent({
      type: "session.native_subagent",
      session_id: "sess-1",
      provider: "codex",
      child_id: "agent-2",
      task: "Review the diff",
    }, options);

    expect(result).toMatchObject({
      type: "vendor.event",
      data: {
        kind: "vendor",
        harness: "codex",
        namespace: "native_subagent",
        name: "update",
        correlation: { work_item_id: "agent-2" },
      },
    });
  });

  it("normalizes Claude Task runtime updates into the canonical agent work item", () => {
    const result = nativeAgentUpdateToOpenMAEvent(
      {
        provider: "claude",
        operation: "claude_agent",
        toolCallId: "task-call-1",
        childId: "agent-1",
        task: "Inspect the repository",
        status: "running",
      },
      {
        sessionId: "sess-1",
        turnId: "turn-1",
        occurredAt: options.occurredAt,
        adapter: "claude",
      },
    );

    expect(result).toMatchObject({
      type: "work_item.started",
      session_id: "sess-1",
      turn_id: "turn-1",
      work_item_id: "agent-1",
      parent_id: "task-call-1",
      source: { harness: "claude", adapter: "claude" },
      data: { kind: "agent", title: "Inspect the repository" },
    });
  });

  it("normalizes Codex child-thread completion under the same work item id", () => {
    const result = nativeAgentUpdateToOpenMAEvent(
      {
        provider: "codex",
        operation: "codex_wait",
        toolCallId: "wait-call-1",
        childId: "thread-7",
        result: "finished",
        status: "complete",
      },
      {
        sessionId: "sess-1",
        turnId: "turn-1",
        occurredAt: "2026-08-04T10:00:05.000Z",
        adapter: "codex",
      },
    );

    expect(result).toMatchObject({
      type: "work_item.completed",
      work_item_id: "thread-7",
      parent_id: "wait-call-1",
      source: { harness: "codex", adapter: "codex" },
      data: { result: "finished" },
    });
  });

  it("keeps native Agent identity on every terminal-only canonical update", () => {
    const terminal = [
      { status: "complete", type: "work_item.completed" },
      { status: "error", type: "work_item.failed" },
      { status: "cancelled", type: "work_item.cancelled" },
      { status: "unknown", type: "work_item.missing_terminal" },
    ] as const;

    for (const item of terminal) {
      expect(nativeAgentUpdateToOpenMAEvent({
        provider: "opencode",
        operation: "subagent_spawn",
        childId: `child-${item.status}`,
        status: item.status,
      }, {
        sessionId: "sess-terminal-only-native",
        occurredAt: options.occurredAt,
        adapter: "opencode",
      })).toMatchObject({
        type: item.type,
        work_item_id: `child-${item.status}`,
        data: { kind: "agent" },
      });
    }
  });

  it("keeps a correlated provider update as vendor data until its lifecycle is explicit", () => {
    const result = nativeAgentUpdateToOpenMAEvent(
      {
        provider: "codex",
        operation: "codex_wait",
        toolCallId: "wait-call-1",
        childId: "thread-7",
        childToolCallId: "child-tool-1",
        childToolName: "read_file",
      },
      {
        sessionId: "sess-1",
        occurredAt: options.occurredAt,
        adapter: "codex",
      },
    );

    expect(result).toMatchObject({
      type: "vendor.event",
      source: { harness: "codex", adapter: "codex" },
      data: {
        kind: "vendor",
        namespace: "native_subagent",
        name: "update",
        correlation: {
          session_id: "sess-1",
          work_item_id: "thread-7",
          parent_id: "wait-call-1",
        },
      },
    });
  });

  it("maps per-work-item usage into the canonical usage.updated event", () => {
    const result = nativeAgentUpdateToOpenMAEvent(
      {
        provider: "claude",
        operation: "claude_agent",
        toolCallId: "task-parent",
        childId: "agent-1",
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          cachedReadTokens: 3,
          cachedWriteTokens: 1,
          totalTokens: 24,
        },
      },
      {
        sessionId: "sess-1",
        turnId: "turn-1",
        occurredAt: options.occurredAt,
        adapter: "claude",
      },
    );

    expect(result).toMatchObject({
      type: "usage.updated",
      work_item_id: "agent-1",
      parent_id: "task-parent",
      data: {
        input_tokens: 12,
        output_tokens: 8,
        total_tokens: 24,
      },
    });
  });

  it("maps provider retry details into canonical work-item progress", () => {
    const result = nativeAgentUpdateToOpenMAEvent(
      {
        provider: "claude",
        operation: "claude_agent",
        toolCallId: "task-parent",
        childId: "agent-1",
        progress: {
          kind: "subagent_retry",
          elapsedTimeSeconds: 12,
          retry: { attempt: 2, max_retries: 5 },
        },
      } as never,
      {
        sessionId: "sess-1",
        turnId: "turn-1",
        occurredAt: options.occurredAt,
        adapter: "claude",
      },
    );

    expect(result).toMatchObject({
      type: "work_item.progress",
      work_item_id: "agent-1",
      parent_id: "task-parent",
      data: {
        output: {
          kind: "subagent_retry",
          elapsedTimeSeconds: 12,
          retry: { attempt: 2, max_retries: 5 },
        },
      },
    });
  });

  it("preserves a provider cancellation reason on the canonical work item", () => {
    const result = nativeAgentUpdateToOpenMAEvent(
      {
        provider: "claude",
        operation: "claude_agent",
        toolCallId: "task-parent",
        childId: "agent-1",
        status: "cancelled",
        reason: "user-rejected",
        errorMessage: "Do not delegate this task",
      } as never,
      {
        sessionId: "sess-1",
        occurredAt: options.occurredAt,
        adapter: "claude",
      },
    );

    expect(result).toMatchObject({
      type: "work_item.cancelled",
      data: {
        reason: "user-rejected",
        error: "Do not delegate this task",
      },
    });
  });

  it("associates nested transcript chunks with the child work item", () => {
    const result = nativeAgentTranscriptToOpenMAEvent(
      {
        provider: "claude",
        parentToolUseId: "task-parent",
        kind: "text",
        text: "child output",
        messageId: "message-1",
        payload: { sessionUpdate: "agent_message_chunk" },
      },
      {
        sessionId: "sess-1",
        turnId: "turn-1",
        childId: "agent-1",
        occurredAt: options.occurredAt,
        adapter: "claude",
      },
    );

    expect(result).toMatchObject({
      type: "agent.message_chunk",
      work_item_id: "agent-1",
      parent_id: "task-parent",
      data: { text: "child output", message_id: "message-1" },
      raw: { source: "adapter" },
    });
  });

  it("maps transport lifecycle to canonical turn and session events", () => {
    expect(toOpenMAEvent({
      type: "session.complete",
      session_id: "sess-1",
      turn_id: "turn-1",
    }, options)).toMatchObject({
      type: "turn.completed",
      turn_id: "turn-1",
    });

    expect(toOpenMAEvent({
      type: "session.error",
      session_id: "sess-1",
      turn_id: "turn-1",
      message: "provider failed",
    }, options)).toMatchObject({
      type: "session.error",
      data: { message: "provider failed" },
    });
  });

  it("attaches the canonical event without removing the legacy transport payload", () => {
    const legacy = {
      type: "session.event" as const,
      session_id: "sess-1",
      turn_id: "turn-1",
      event: { sessionUpdate: "future_event", value: 1 },
    };
    const enriched = attachOpenMAEvent(legacy, options);

    expect(enriched.type).toBe("session.event");
    if (enriched.type !== "session.event") throw new Error("expected session.event");
    expect(enriched.event).toEqual(legacy.event);
    expect(enriched.openma_event).toMatchObject({
      type: "raw.event",
      session_id: "sess-1",
      turn_id: "turn-1",
    });
  });
});
