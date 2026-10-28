import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createOpenMAEvent } from "@openma/common/session-events/openma";
import { attachOpenMAEvent } from "@shared/openma-event.js";
import { reduceTurn } from "./reduce-turn";
import { SessionStore } from "./session-store";

describe("SessionStore canonical OpenMA events", () => {
  it("persists renderer-derived native Agent canonical events through the host boundary", () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      backchat: { sessionPersistCanonicalEvent: persist },
    });
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-native-persist",
      acp_session_id: "acp-native-persist",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-native-persist", "sess-native-persist", "delegate");
    store.apply({
      type: "session.event",
      session_id: "sess-native-persist",
      turn_id: "turn-native-persist",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "task-tool",
        title: "Task",
        status: "pending",
        rawInput: { description: "Inspect the repository", prompt: "inspect" },
      },
    });

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "oma.event.v1",
        type: "work_item.started",
        session_id: "sess-native-persist",
      }),
    );
  });

  it("projects canonical system notices into the existing composer notice slot", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-system-notice",
      acp_session_id: "acp-system-notice",
      agent_id: "pi-acp",
      cwd: "/tmp/project",
    });
    store.apply({
      type: "session.event",
      session_id: "sess-system-notice",
      turn_id: "turn-system-notice",
      event: { sessionUpdate: "unknown_transport" },
      openma_event: createOpenMAEvent({
        event_id: "pi-system-notice",
        session_id: "sess-system-notice",
        turn_id: "turn-system-notice",
        source: { kind: "harness", harness: "pi-acp", adapter: "pi" },
        occurred_at: "2026-08-05T00:00:00.000Z",
        type: "system.notice",
        data: {
          message: "Model fallback engaged",
          tone: "warning",
        },
      }),
    });

    expect(store.get("sess-system-notice")?.notice).toMatchObject({
      message: "Model fallback engaged",
      tone: "warning",
    });
  });

  it("projects legacy ACP modes from the canonical session start into the existing mode control", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-modes",
      acp_session_id: "acp-modes",
      agent_id: "kimi-acp",
      cwd: "/tmp/project",
      openma_event: createOpenMAEvent({
        event_id: "session-started-modes",
        type: "session.started",
        session_id: "sess-modes",
        source: { kind: "harness", harness: "kimi-acp", adapter: "acp" },
        occurred_at: "2026-08-04T10:00:00.000Z",
        data: {
          acp_session_id: "acp-modes",
          agent_id: "kimi-acp",
          cwd: "/tmp/project",
          modes: {
            currentModeId: "ask",
            availableModes: [
              { id: "ask", name: "Ask", description: "Ask before edits" },
              { id: "code", name: "Code" },
            ],
          },
        },
      }),
    });

    expect(store.get("sess-modes")?.configOptions).toEqual([
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "ask",
        options: [
          { value: "ask", name: "Ask", description: "Ask before edits" },
          { value: "code", name: "Code" },
        ],
      },
    ]);
    expect(store.get("sess-modes")?.currentModeId).toBe("ask");
  });

  it("projects a canonical current-mode update into the existing mode control", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-mode-update",
      acp_session_id: "acp-mode-update",
      agent_id: "kimi-acp",
      cwd: "/tmp/project",
      modes: {
        currentModeId: "ask",
        availableModes: [
          { id: "ask", name: "Ask" },
          { id: "code", name: "Code" },
        ],
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-mode-update",
      turn_id: "",
      event: { sessionUpdate: "future_transport_shape" },
      openma_event: createOpenMAEvent({
        event_id: "mode-update-code",
        type: "capability.updated",
        session_id: "sess-mode-update",
        source: { kind: "harness", harness: "kimi-acp", adapter: "acp" },
        occurred_at: "2026-08-04T10:00:01.000Z",
        data: {
          sessionUpdate: "current_mode_update",
          currentModeId: "code",
        },
      }),
    });

    expect(store.get("sess-mode-update")?.currentModeId).toBe("code");
    expect(store.get("sess-mode-update")?.configOptions?.[0]?.currentValue).toBe("code");
  });

  it("materializes WorkItem state from the canonical event field", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp",
    });

    const base = {
      session_id: "sess-1",
      turn_id: "turn-1",
      source: { kind: "harness" as const, harness: "claude-acp", adapter: "claude" },
      occurred_at: "2026-08-04T10:00:00.000Z",
      work_item_id: "work-1",
    };
    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: { sessionUpdate: "future_event" },
      openma_event: createOpenMAEvent({
        ...base,
        event_id: "work-started",
        type: "work_item.started",
        data: { kind: "agent", title: "Inspect" },
      }),
    });
    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: { sessionUpdate: "future_event" },
      openma_event: createOpenMAEvent({
        ...base,
        event_id: "work-completed",
        type: "work_item.completed",
        occurred_at: "2026-08-04T10:00:02.000Z",
        data: { result: "done" },
      }),
    });

    expect(store.workItemsFor("sess-1")).toMatchObject([
      {
        id: "work-1",
        kind: "agent",
        title: "Inspect",
        status: "completed",
        result: "done",
      },
    ]);
  });

  it("reduces ACP background-process transport into a completed bash work item", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-terminal",
      acp_session_id: "acp-terminal",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });

    const options = {
      occurredAt: "2026-08-04T10:00:00.000Z",
      harness: "claude-acp",
      adapter: "acp-terminal",
    };
    store.apply(attachOpenMAEvent({
      type: "session.background_process",
      session_id: "sess-terminal",
      process_id: "term-1",
      seq: 1,
      phase: "started",
      command: "pnpm",
      args: ["test"],
      cwd: "/tmp/project",
    }, options));
    store.apply(attachOpenMAEvent({
      type: "session.background_process",
      session_id: "sess-terminal",
      process_id: "term-1",
      seq: 2,
      phase: "output",
      output: "42 tests passed\n",
    }, options));
    store.apply(attachOpenMAEvent({
      type: "session.background_process",
      session_id: "sess-terminal",
      process_id: "term-1",
      seq: 3,
      phase: "completed",
      exit_code: 0,
      signal: null,
    }, { ...options, occurredAt: "2026-08-04T10:00:05.000Z" }));

    expect(store.workItemsFor("sess-terminal")).toMatchObject([
      {
        id: "term-1",
        kind: "bash",
        title: "pnpm test",
        status: "completed",
        output: "42 tests passed\n",
        result: { exit_code: 0, signal: null },
      },
    ]);
  });

  it("renders canonical tool lifecycle in the existing Tool slot without understanding the transport payload", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-tool",
      acp_session_id: "acp-tool",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-tool", "sess-tool", "run tests");

    const base = {
      session_id: "sess-tool",
      turn_id: "turn-tool",
      source: { kind: "harness" as const, harness: "codex-acp", adapter: "codex" },
      occurred_at: "2026-08-04T10:00:00.000Z",
    };
    const applyCanonicalTool = (
      event_id: string,
      type: "tool.started" | "tool.progress" | "tool.completed",
      data: Record<string, unknown>,
    ) => store.apply({
      type: "session.event",
      session_id: "sess-tool",
      turn_id: "turn-tool",
      event: { sessionUpdate: "future_transport_shape", opaque: true },
      openma_event: createOpenMAEvent({ ...base, event_id, type, data }),
    });

    applyCanonicalTool("tool-start", "tool.started", {
      tool_call_id: "shell-1",
      title: "pnpm test",
      kind: "execute",
      status: "in_progress",
      content: [{ type: "terminal", terminalId: "shell-1" }],
    });
    applyCanonicalTool("tool-output-1", "tool.progress", {
      tool_call_id: "shell-1",
      output: { kind: "terminal", data: "12 tests ", terminal_id: "shell-1", append: true },
    });
    applyCanonicalTool("tool-output-2", "tool.progress", {
      tool_call_id: "shell-1",
      output: { kind: "terminal", data: "passed\n", terminal_id: "shell-1", append: true },
    });
    applyCanonicalTool("tool-exit", "tool.completed", {
      tool_call_id: "shell-1",
      status: "completed",
      terminal: { terminal_id: "shell-1", exit_code: 0, signal: null },
    });

    const turn = store.turnsFor("sess-tool")[0];
    expect(reduceTurn(turn?.events ?? []).tools).toEqual([
      expect.objectContaining({
        toolCallId: "shell-1",
        title: "pnpm test",
        kind: "execute",
        status: "completed",
        rawOutput: "12 tests passed\n",
        content: [{ type: "terminal", terminalId: "shell-1" }],
      }),
    ]);
  });

  it("shows a canonical tool failure reason in the existing Tool result", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-tool-failure",
      acp_session_id: "acp-tool-failure",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-tool-failure", "sess-tool-failure", "deploy");
    const base = {
      session_id: "sess-tool-failure",
      turn_id: "turn-tool-failure",
      source: { kind: "harness" as const, harness: "claude-acp", adapter: "claude" },
      occurred_at: "2026-08-04T10:00:00.000Z",
    };
    store.apply({
      type: "session.event",
      session_id: "sess-tool-failure",
      turn_id: "turn-tool-failure",
      event: { sessionUpdate: "unknown_transport" },
      openma_event: createOpenMAEvent({
        ...base,
        event_id: "tool-failure-start",
        type: "tool.started",
        data: {
          tool_call_id: "shell-denied",
          title: "deploy",
          kind: "execute",
          status: "pending",
        },
      }),
    });
    store.apply({
      type: "session.event",
      session_id: "sess-tool-failure",
      turn_id: "turn-tool-failure",
      event: { sessionUpdate: "unknown_transport" },
      openma_event: createOpenMAEvent({
        ...base,
        event_id: "tool-failure-end",
        type: "tool.failed",
        data: {
          tool_call_id: "shell-denied",
          status: "failed",
          reason: "user-rejected",
          error: "Do not run the deployment command",
        },
      }),
    });

    const turn = store.turnsFor("sess-tool-failure")[0];
    expect(reduceTurn(turn?.events ?? []).tools[0]).toMatchObject({
      toolCallId: "shell-denied",
      status: "failed",
      rawOutput: "Do not run the deployment command",
    });
  });

  it("projects the ACP client's preemptive tool cancellation into the existing Tool slot", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-tool-cancelled",
      acp_session_id: "acp-tool-cancelled",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-tool-cancelled", "sess-tool-cancelled", "run");
    store.apply({
      type: "session.event",
      session_id: "sess-tool-cancelled",
      turn_id: "turn-tool-cancelled",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-cancelled",
        title: "Long-running command",
        status: "in_progress",
      },
    });
    store.apply({
      type: "session.tool_cancelled",
      session_id: "sess-tool-cancelled",
      turn_id: "turn-tool-cancelled",
      tool_call_id: "tool-cancelled",
      reason: "user_stop",
      openma_event: {
        schema_version: "oma.event.v1",
        event_id: "tool-cancelled-by-client",
        type: "tool.cancelled",
        session_id: "sess-tool-cancelled",
        turn_id: "turn-tool-cancelled",
        source: { kind: "openma", adapter: "acp-client" },
        occurred_at: "2026-08-05T00:00:00.000Z",
        data: {
          tool_call_id: "tool-cancelled",
          status: "cancelled",
          reason: "user_stop",
        },
      },
    } as never);

    expect(reduceTurn(
      store.turnsFor("sess-tool-cancelled")[0]?.events ?? [],
    ).tools[0]).toMatchObject({
      toolCallId: "tool-cancelled",
      status: "cancelled",
    });
  });

  it("projects canonical Codex session lifecycle into existing status, archive, and notice slots", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-codex-lifecycle",
      acp_session_id: "acp-codex-lifecycle",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    const base = {
      session_id: "sess-codex-lifecycle",
      source: { kind: "harness" as const, harness: "codex-acp", adapter: "codex" },
      occurred_at: "2026-08-04T10:00:00.000Z",
    };
    const applyCanonicalSession = (
      event_id: string,
      type: "session.running" | "session.idle" | "session.terminated" | "capability.updated",
      data: Record<string, unknown>,
    ) => store.apply({
      type: "session.event",
      session_id: "sess-codex-lifecycle",
      turn_id: "",
      event: { sessionUpdate: "unknown_transport" },
      openma_event: createOpenMAEvent({ ...base, event_id, type, data }),
    });

    applyCanonicalSession("codex-active", "session.running", {
      thread_status: { type: "active" },
    });
    expect(store.get("sess-codex-lifecycle")?.status).toBe("running");
    expect(store.get("sess-codex-lifecycle")?.agentThreadStatus).toBe("active");

    applyCanonicalSession("codex-retry", "session.running", {
      retrying: true,
      provider_error: { message: "connection reset", willRetry: true },
    });
    expect(store.get("sess-codex-lifecycle")?.notice?.message).toBe("connection reset");


    applyCanonicalSession("codex-idle", "session.idle", {
      thread_status: { type: "idle" },
    });
    expect(store.get("sess-codex-lifecycle")?.status).toBe("ready");
    expect(store.get("sess-codex-lifecycle")?.agentThreadStatus).toBe("idle");

    applyCanonicalSession("codex-archive", "capability.updated", {
      session_archived: true,
    });
    expect(store.get("sess-codex-lifecycle")?.archivedAt).toEqual(expect.any(Number));

    applyCanonicalSession("codex-unarchive", "capability.updated", {
      session_archived: false,
    });
    expect(store.get("sess-codex-lifecycle")?.archivedAt).toBeUndefined();

    applyCanonicalSession("codex-closed", "session.terminated", {
      reason: "provider_closed",
    });
    expect(store.get("sess-codex-lifecycle")?.status).toBe("disposed");
  });

  it("fails the running turn when a canonical provider error arrives without a turn id", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-codex-provider-failure",
      acp_session_id: "acp-codex-provider-failure",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn(
      "turn-provider-failure",
      "sess-codex-provider-failure",
      "hello",
    );
    expect(store.get("sess-codex-provider-failure")?.status).toBe("running");

    // Out-of-band provider failures carry no turn id; the session's active
    // turn is the one that failed.
    store.apply({
      type: "session.event",
      session_id: "sess-codex-provider-failure",
      turn_id: "",
      event: { sessionUpdate: "session_info_update" },
      openma_event: createOpenMAEvent({
        event_id: "codex-provider-failure",
        type: "session.error",
        session_id: "sess-codex-provider-failure",
        turn_id: "",
        source: { kind: "harness", harness: "codex-acp", adapter: "codex" },
        occurred_at: "2026-08-04T10:00:00.000Z",
        data: {
          message: "auth_unavailable: no auth available (providers=devin)",
          code: "auth_required",
          provider_error: { message: "Reconnecting... 2/5", willRetry: true },
        },
      }),
    });

    const turn = store.turnsFor("sess-codex-provider-failure")[0];
    expect(turn?.status).toBe("error");
    expect(turn?.errorMessage).toContain("auth_unavailable");
    expect(store.get("sess-codex-provider-failure")?.status).not.toBe("running");
    expect(store.get("sess-codex-provider-failure")?.activeTurnId).toBeUndefined();
  });

  it("fails the running turn for a non-auth provider error too", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-codex-provider-failure-plain",
      acp_session_id: "acp-codex-provider-failure-plain",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn(
      "turn-provider-failure-plain",
      "sess-codex-provider-failure-plain",
      "hello",
    );

    store.apply({
      type: "session.event",
      session_id: "sess-codex-provider-failure-plain",
      turn_id: "",
      event: { sessionUpdate: "session_info_update" },
      openma_event: createOpenMAEvent({
        event_id: "codex-provider-failure-plain",
        type: "session.error",
        session_id: "sess-codex-provider-failure-plain",
        turn_id: "",
        source: { kind: "harness", harness: "codex-acp", adapter: "codex" },
        occurred_at: "2026-08-04T10:00:00.000Z",
        data: { message: "the model returned an invalid response" },
      }),
    });

    const turn = store.turnsFor("sess-codex-provider-failure-plain")[0];
    expect(turn?.status).toBe("error");
    expect(turn?.errorMessage).toBe("the model returned an invalid response");
    expect(store.get("sess-codex-provider-failure-plain")?.activeTurnId).toBeUndefined();
  });

  it("keeps a soft provider reconnect notice-only and keeps the turn running", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-codex-soft-retry",
      acp_session_id: "acp-codex-soft-retry",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-soft-retry", "sess-codex-soft-retry", "hello");

    store.apply({
      type: "session.event",
      session_id: "sess-codex-soft-retry",
      turn_id: "",
      event: { sessionUpdate: "session_info_update" },
      openma_event: createOpenMAEvent({
        event_id: "codex-soft-retry",
        type: "session.running",
        session_id: "sess-codex-soft-retry",
        turn_id: "",
        source: { kind: "harness", harness: "codex-acp", adapter: "codex" },
        occurred_at: "2026-08-04T10:00:00.000Z",
        data: {
          retrying: true,
          message: "upstream connect timeout, retrying",
          provider_error: { message: "Reconnecting... 1/5", willRetry: true },
        },
      }),
    });

    expect(store.turnsFor("sess-codex-soft-retry")[0]?.status).toBe("running");
    expect(store.get("sess-codex-soft-retry")?.status).toBe("running");
    expect(store.get("sess-codex-soft-retry")?.notice?.message).toBe(
      "upstream connect timeout, retrying",
    );
  });

  it("drives message, thinking, plan, command, usage, and config slots from canonical events alone", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-canonical-native",
      acp_session_id: "acp-canonical-native",
      agent_id: "kimi-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn(
      "turn-canonical-native",
      "sess-canonical-native",
      "inspect",
    );
    const base = {
      session_id: "sess-canonical-native",
      turn_id: "turn-canonical-native",
      source: { kind: "harness" as const, harness: "kimi-acp", adapter: "acp" },
      occurred_at: "2026-08-04T10:00:00.000Z",
    };
    const applyCanonical = (
      event_id: string,
      type: "agent.message_chunk" | "agent.thinking" | "plan.updated" | "command_catalog.updated" | "usage.updated" | "capability.updated",
      data: Record<string, unknown>,
    ) => store.apply({
      type: "session.event",
      session_id: base.session_id,
      turn_id: base.turn_id,
      event: { sessionUpdate: "unknown_transport", opaque: event_id },
      openma_event: createOpenMAEvent({ ...base, event_id, type, data }),
    });

    applyCanonical("thinking", "agent.thinking", {
      text: "Checking the adapter",
      message_id: "thought-1",
    });
    applyCanonical("message", "agent.message_chunk", {
      text: "The adapter is ready.",
      message_id: "message-1",
    });
    applyCanonical("plan", "plan.updated", {
      entries: [{ content: "Verify lifecycle", status: "in_progress", priority: "high" }],
    });
    applyCanonical("commands", "command_catalog.updated", {
      commands: [{ name: "review", description: "Review changes" }],
    });
    applyCanonical("usage", "usage.updated", { used: 42, size: 200 });
    applyCanonical("config", "capability.updated", {
      sessionUpdate: "config_option_update",
      configOptions: [{
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "kimi-k2",
        options: [{ value: "kimi-k2", name: "Kimi K2" }],
      }],
    });
    applyCanonical("session-info", "capability.updated", {
      sessionUpdate: "session_info_update",
      title: "Canonical session title",
      updatedAt: "2026-08-04T10:00:01.000Z",
    });

    const turn = store.turnsFor(base.session_id)[0];
    const rendered = reduceTurn(turn?.events ?? []);
    expect(turn).toMatchObject({
      thoughtText: "Checking the adapter",
      assistantText: "The adapter is ready.",
    });
    expect(rendered.plan).toEqual([
      { content: "Verify lifecycle", status: "in_progress", priority: "high" },
    ]);
    expect(store.get(base.session_id)).toMatchObject({
      availableCommands: [{ name: "review", description: "Review changes" }],
      usage: { used: 42, size: 200 },
      label: "Canonical session title",
      sessionUpdatedAt: "2026-08-04T10:00:01.000Z",
      configOptions: [expect.objectContaining({ id: "model", currentValue: "kimi-k2" })],
    });
  });

  it("renders an attached ACP Markdown plan through its canonical event", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-plan-document",
      acp_session_id: "acp-plan-document",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-plan-document", "sess-plan-document", "plan");
    store.apply(attachOpenMAEvent({
      type: "session.event",
      session_id: "sess-plan-document",
      turn_id: "turn-plan-document",
      event: {
        sessionUpdate: "plan_update",
        plan: {
          id: "plan-1",
          title: "Release",
          content: { markdown: "# Release\n\nShip it" },
        },
      },
    }, {
      occurredAt: "2026-08-04T10:00:00.000Z",
      harness: "claude-acp",
      adapter: "claude",
    }));

    expect(reduceTurn(
      store.turnsFor("sess-plan-document")[0]?.events ?? [],
    ).planDocument).toEqual({
      id: "plan-1",
      title: "Release",
      markdown: "# Release\n\nShip it",
    });
  });

  it("projects Cursor generated-image extension paths into existing Outputs and Sources", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-cursor-image",
      acp_session_id: "acp-cursor-image",
      agent_id: "cursor",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-cursor-image", "sess-cursor-image", "generate image");

    store.apply(attachOpenMAEvent({
      type: "session.event",
      session_id: "sess-cursor-image",
      turn_id: "turn-cursor-image",
      event: {
        type: "acp.extension_request",
        method: "cursor/generate_image",
        params: {
          toolCallId: "image-call-1",
          description: "Release illustration",
          filePath: "/tmp/project/release.png",
          referenceImagePaths: [
            "/tmp/project/reference-a.png",
            "/tmp/project/reference-b.png",
          ],
        },
      },
    }, {
      occurredAt: "2026-08-04T10:00:00.000Z",
      harness: "cursor",
      adapter: "cursor",
    }));

    expect(store.artifactsFor("sess-cursor-image")).toMatchObject({
      files: ["/tmp/project/release.png"],
      sources: [
        { kind: "file", uri: "/tmp/project/reference-a.png" },
        { kind: "file", uri: "/tmp/project/reference-b.png" },
      ],
    });
  });

  it("projects canonical ACP resource links into the existing Sources slot", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-agent-resource",
      acp_session_id: "acp-agent-resource",
      agent_id: "kimi-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn(
      "turn-agent-resource",
      "sess-agent-resource",
      "cite the reference",
    );

    store.apply(attachOpenMAEvent({
      type: "session.event",
      session_id: "sess-agent-resource",
      turn_id: "turn-agent-resource",
      event: {
        sessionUpdate: "agent_message_chunk",
        messageId: "resource-message-1",
        content: {
          type: "resource_link",
          uri: "https://example.com/reference.pdf",
          name: "reference.pdf",
          title: "Reference",
          mimeType: "application/pdf",
        },
      },
    }, {
      occurredAt: "2026-08-04T10:00:00.000Z",
      harness: "kimi-acp",
      adapter: "acp",
    }));

    expect(store.artifactsFor("sess-agent-resource").sources).toEqual([
      {
        kind: "web",
        uri: "https://example.com/reference.pdf",
        label: "Reference",
      },
    ]);
  });

  it("projects standard ACP Tool resource content into the existing Sources slot", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-tool-resource",
      acp_session_id: "acp-tool-resource",
      agent_id: "kimi-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn(
      "turn-tool-resource",
      "sess-tool-resource",
      "fetch the references",
    );

    store.apply(attachOpenMAEvent({
      type: "session.event",
      session_id: "sess-tool-resource",
      turn_id: "turn-tool-resource",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "fetch-resource-1",
        title: "Fetch references",
        kind: "fetch",
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "resource_link",
              uri: "https://example.com/tool-reference",
              name: "Tool reference",
            },
          },
          {
            type: "content",
            content: {
              type: "resource",
              resource: {
                uri: "file:///tmp/project/context.txt",
                text: "context",
                mimeType: "text/plain",
              },
            },
          },
        ],
      },
    }, {
      occurredAt: "2026-08-04T10:00:00.000Z",
      harness: "kimi-acp",
      adapter: "acp",
    }));

    expect(store.artifactsFor("sess-tool-resource").sources).toEqual([
      {
        kind: "web",
        uri: "https://example.com/tool-reference",
        label: "Tool reference",
      },
      {
        kind: "file",
        uri: "/tmp/project/context.txt",
      },
    ]);
  });

  it("keeps one Cursor Agent while extension identity and standard Tool lifecycle converge", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-cursor-task",
      acp_session_id: "acp-cursor-task",
      agent_id: "cursor",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-cursor-task", "sess-cursor-task", "delegate audit");
    const attach = (event: Record<string, unknown>, occurredAt: string) =>
      attachOpenMAEvent({
        type: "session.event" as const,
        session_id: "sess-cursor-task",
        turn_id: "turn-cursor-task",
        event,
      }, {
        occurredAt,
        harness: "cursor",
        adapter: "cursor",
      });

    store.apply(attach({
      sessionUpdate: "tool_call",
      toolCallId: "cursor-task-call-1",
      title: "Explore the event pipeline",
      kind: "other",
      status: "pending",
      rawInput: {
        _toolName: "task",
        description: "Explore the event pipeline",
        prompt: "Inspect all event boundaries",
        subagentType: "explore",
      },
    }, "2026-08-04T10:00:00.000Z"));

    expect(store.subagentsFor("sess-cursor-task")).toEqual([
      expect.objectContaining({
        childSessionId: "cursor:cursor-task-call-1",
        status: "running",
        task: "Explore the event pipeline",
        native: expect.objectContaining({
          provider: "cursor",
          toolCallId: "cursor-task-call-1",
        }),
      }),
    ]);
    expect(store.workItemsFor("sess-cursor-task")).toMatchObject([
      {
        id: "cursor:cursor-task-call-1",
        kind: "agent",
        status: "running",
      },
    ]);

    store.apply(attach({
      type: "acp.extension_request",
      method: "cursor/task",
      params: {
        toolCallId: "cursor-task-call-1",
        description: "Explore the event pipeline",
        subagentType: "explore",
        agentId: "cursor-child-7",
        durationMs: 1250,
      },
    }, "2026-08-04T10:00:01.000Z"));

    expect(store.subagentsFor("sess-cursor-task")).toEqual([
      expect.objectContaining({
        childSessionId: "cursor-child-7",
        status: "running",
      }),
    ]);
    expect(store.workItemsFor("sess-cursor-task")).toMatchObject([
      {
        id: "cursor-child-7",
        kind: "agent",
        status: "running",
      },
    ]);

    store.apply(attach({
      sessionUpdate: "tool_call_update",
      toolCallId: "cursor-task-call-1",
      status: "completed",
      rawOutput: { durationMs: 1250, isBackground: false },
    }, "2026-08-04T10:00:02.000Z"));

    expect(store.subagentsFor("sess-cursor-task")).toEqual([
      expect.objectContaining({
        childSessionId: "cursor-child-7",
        status: "complete",
      }),
    ]);
    expect(store.workItemsFor("sess-cursor-task")).toMatchObject([
      {
        id: "cursor-child-7",
        kind: "agent",
        status: "completed",
      },
    ]);
  });

  it("projects Cursor todo extension updates into the existing Plan slot", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-cursor-plan",
      acp_session_id: "acp-cursor-plan",
      agent_id: "cursor",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-cursor-plan", "sess-cursor-plan", "plan audit");

    store.apply(attachOpenMAEvent({
      type: "session.event",
      session_id: "sess-cursor-plan",
      turn_id: "turn-cursor-plan",
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
    }, {
      occurredAt: "2026-08-04T10:00:00.000Z",
      harness: "cursor",
      adapter: "cursor",
    }));

    expect(reduceTurn(
      store.turnsFor("sess-cursor-plan")[0]?.events ?? [],
    ).plan).toEqual([
      { id: "todo-1", content: "Audit inputs", status: "completed", priority: undefined },
      { id: "todo-2", content: "Wire outputs", status: "in_progress", priority: undefined },
    ]);
  });

  it("uses Cursor Task raw output errors for the existing Agent failure state", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-cursor-task-error",
      acp_session_id: "acp-cursor-task-error",
      agent_id: "cursor",
      cwd: "/tmp/project",
    });
    store.registerTurn(
      "turn-cursor-task-error",
      "sess-cursor-task-error",
      "delegate failing audit",
    );
    const applyTool = (event: Record<string, unknown>, occurredAt: string) =>
      store.apply(attachOpenMAEvent({
        type: "session.event",
        session_id: "sess-cursor-task-error",
        turn_id: "turn-cursor-task-error",
        event,
      }, {
        occurredAt,
        harness: "cursor",
        adapter: "cursor",
      }));

    applyTool({
      sessionUpdate: "tool_call",
      toolCallId: "cursor-task-error-1",
      title: "Inspect failure",
      status: "pending",
      rawInput: {
        _toolName: "task",
        description: "Inspect failure",
        subagentType: "explore",
      },
    }, "2026-08-04T10:00:00.000Z");
    applyTool({
      sessionUpdate: "tool_call_update",
      toolCallId: "cursor-task-error-1",
      status: "completed",
      rawOutput: { error: "Subagent failed" },
    }, "2026-08-04T10:00:01.000Z");

    expect(store.subagentsFor("sess-cursor-task-error")).toEqual([
      expect.objectContaining({
        childSessionId: "cursor:cursor-task-error-1",
        status: "error",
        errorMessage: "Subagent failed",
      }),
    ]);
    expect(store.workItemsFor("sess-cursor-task-error")).toMatchObject([
      {
        id: "cursor:cursor-task-error-1",
        status: "failed",
        error: "Subagent failed",
      },
    ]);
  });

  it("passes canonical plan removal through the existing turn Plan projection", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-plan-removal",
      acp_session_id: "acp-plan-removal",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-plan-removal", "sess-plan-removal", "plan");
    const base = {
      session_id: "sess-plan-removal",
      turn_id: "turn-plan-removal",
      source: { kind: "harness" as const, harness: "codex-acp", adapter: "codex" },
      occurred_at: "2026-08-04T10:00:00.000Z",
    };
    store.apply({
      type: "session.event",
      session_id: base.session_id,
      turn_id: base.turn_id,
      event: { sessionUpdate: "future_plan_transport" },
      openma_event: createOpenMAEvent({
        ...base,
        event_id: "plan-added",
        type: "plan.updated",
        data: {
          representation: "items",
          plan_id: "release-plan",
          entries: [{ content: "Ship", status: "in_progress" }],
        },
      }),
    });
    store.apply({
      type: "session.event",
      session_id: base.session_id,
      turn_id: base.turn_id,
      event: { sessionUpdate: "future_plan_transport" },
      openma_event: createOpenMAEvent({
        ...base,
        event_id: "plan-removed",
        type: "plan.removed",
        data: { plan_id: "release-plan" },
      }),
    });

    expect(reduceTurn(
      store.turnsFor(base.session_id)[0]?.events ?? [],
    ).plan).toEqual([]);
  });

  it.each(["opencode", "kilo"])(
    "projects %s todowrite through canonical Plan instead of a raw GUI parser",
    (agentId) => {
      const store = new SessionStore();
      const sessionId = `sess-${agentId}-canonical-todos`;
      const turnId = `turn-${agentId}-canonical-todos`;
      store.apply({
        type: "session.ready",
        session_id: sessionId,
        acp_session_id: `acp-${agentId}-canonical-todos`,
        agent_id: agentId,
        cwd: "/tmp/project",
      });
      store.registerTurn(turnId, sessionId, "update tasks");
      store.apply({
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event: {
          sessionUpdate: "tool_call",
          toolCallId: "todos-1",
          title: "todowrite",
          status: "pending",
          rawInput: {
            todos: [
              {
                id: "todo-a",
                content: "Inspect adapter",
                status: "completed",
                priority: "high",
              },
              {
                id: "todo-b",
                content: "Persist canonical plan",
                status: "in_progress",
                priority: "medium",
              },
            ],
          },
        },
      });

      expect(store.openmaEventsFor(sessionId)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "plan.updated",
          source: expect.objectContaining({ adapter: agentId }),
          data: {
            representation: "items",
            plan_id: "todos-1",
            update_mode: "replace",
            entries: [
              {
                id: "todo-a",
                content: "Inspect adapter",
                status: "completed",
                priority: "high",
              },
              {
                id: "todo-b",
                content: "Persist canonical plan",
                status: "in_progress",
                priority: "medium",
              },
            ],
          },
        }),
      ]));
      expect(reduceTurn(store.turnsFor(sessionId)[0]?.events ?? []).plan).toEqual([
        {
          id: "todo-a",
          content: "Inspect adapter",
          status: "completed",
          priority: "high",
        },
        {
          id: "todo-b",
          content: "Persist canonical plan",
          status: "in_progress",
          priority: "medium",
        },
      ]);
    },
  );

  it("tracks structured Claude Bash and TaskStop lifecycle without inventing completion", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-claude-background",
      acp_session_id: "acp-claude-background",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-background", "sess-claude-background", "start watcher");
    store.apply({
      type: "session.event",
      session_id: "sess-claude-background",
      turn_id: "turn-background",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "bash-call-1",
        status: "pending",
        rawInput: { command: "pnpm test --watch", run_in_background: true },
        _meta: { claudeCode: { toolName: "Bash" } },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-claude-background",
      turn_id: "turn-background",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "bash-call-1",
        status: "completed",
        _meta: {
          claudeCode: {
            toolName: "Bash",
            toolResponse: {
              backgroundTaskId: "bash-task-1",
              stdout: "",
              stderr: "",
              interrupted: false,
            },
          },
        },
      },
    });

    expect(store.workItemsFor("sess-claude-background")).toEqual([
      expect.objectContaining({
        id: "bash-task-1",
        kind: "bash",
        title: "pnpm test --watch",
        status: "running",
      }),
    ]);

    store.apply({
      type: "session.complete",
      session_id: "sess-claude-background",
      turn_id: "turn-background",
    });
    expect(store.workItemsFor("sess-claude-background")[0]).toMatchObject({
      id: "bash-task-1",
      status: "unknown",
      missing_terminal: true,
      reason: "parent_turn_completed",
    });

    store.registerTurn("turn-stop", "sess-claude-background", "stop watcher");
    store.apply({
      type: "session.event",
      session_id: "sess-claude-background",
      turn_id: "turn-stop",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "stop-call-1",
        status: "pending",
        rawInput: { task_id: "bash-task-1" },
        _meta: { claudeCode: { toolName: "TaskStop" } },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-claude-background",
      turn_id: "turn-stop",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "stop-call-1",
        status: "completed",
        _meta: {
          claudeCode: {
            toolName: "TaskStop",
            toolResponse: { task_id: "bash-task-1", message: "Stopped" },
          },
        },
      },
    });

    expect(store.workItemsFor("sess-claude-background")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "bash-task-1",
          kind: "bash",
          status: "killed",
          missing_terminal: false,
          reason: "task_stop",
        }),
      ]),
    );
  });

  it("keeps TaskOutput in Tool and projects the raw Claude Monitor lifecycle", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-claude-monitor",
      acp_session_id: "acp-claude-monitor",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-monitor", "sess-claude-monitor", "watch CI");

    store.apply({
      type: "session.event",
      session_id: "sess-claude-monitor",
      turn_id: "turn-monitor",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "output-call-1",
        status: "pending",
        rawInput: { task_id: "monitor-task-1", block: true, timeout: 30_000 },
        _meta: { claudeCode: { toolName: "TaskOutput" } },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-claude-monitor",
      turn_id: "turn-monitor",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "output-call-1",
        status: "completed",
        rawOutput: "Monitor is still running",
        _meta: { claudeCode: { toolName: "TaskOutput" } },
      },
    });

    expect(store.workItemsFor("sess-claude-monitor")).toEqual([]);

    store.apply({
      type: "session.event",
      session_id: "sess-claude-monitor",
      turn_id: "turn-monitor",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "monitor-call-1",
        status: "pending",
        rawInput: {
          description: "Watch CI until it settles",
          command: "gh run watch",
          timeout_ms: 300_000,
          persistent: false,
        },
        _meta: { claudeCode: { toolName: "Monitor" } },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-claude-monitor",
      turn_id: "turn-monitor",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "monitor-call-1",
        status: "completed",
        _meta: {
          claudeCode: {
            toolName: "Monitor",
            toolResponse: {
              taskId: "monitor-task-1",
              timeoutMs: 300_000,
              persistent: false,
            },
          },
        },
      },
    });

    expect(store.workItemsFor("sess-claude-monitor")).toEqual([
      expect.objectContaining({
        id: "monitor-task-1",
        kind: "monitor",
        title: "Watch CI until it settles",
        status: "running",
      }),
    ]);

    store.apply({
      type: "session.event",
      session_id: "sess-claude-monitor",
      turn_id: "turn-monitor",
      event: {
        type: "acp.extension_notification",
        method: "_claude/sdkMessage",
        params: {
          sessionId: "acp-claude-monitor",
          message: {
            type: "system",
            subtype: "task_started",
            task_id: "monitor-task-1",
            tool_use_id: "monitor-call-1",
            task_type: "local_bash",
            description: "Watch CI until it settles",
            uuid: "00000000-0000-4000-8000-000000000061",
            session_id: "sdk-claude-monitor",
          },
        },
      },
    });

    expect(store.workItemsFor("sess-claude-monitor")).toEqual([
      expect.objectContaining({
        id: "monitor-task-1",
        kind: "monitor",
        title: "Watch CI until it settles",
        status: "running",
      }),
    ]);

    store.apply({
      type: "session.event",
      session_id: "sess-claude-monitor",
      turn_id: "turn-monitor",
      event: {
        type: "acp.extension_notification",
        method: "_claude/sdkMessage",
        params: {
          sessionId: "acp-claude-monitor",
          message: {
            type: "system",
            subtype: "task_notification",
            task_id: "monitor-task-1",
            status: "completed",
            output_file: "/tmp/monitor-task-1.output",
            summary: "Monitor exited with code 0",
          },
        },
      },
    });

    expect(store.workItemsFor("sess-claude-monitor")).toEqual([
      expect.objectContaining({
        id: "monitor-task-1",
        kind: "monitor",
        title: "Watch CI until it settles",
        status: "completed",
        result: {
          output_file: "/tmp/monitor-task-1.output",
          summary: "Monitor exited with code 0",
        },
      }),
    ]);
  });

  it("settles a Claude native Agent from the correlated SDK task notification", () => {
    const store = new SessionStore();
    const sessionId = "sess-claude-agent-terminal";
    const turnId = "turn-claude-agent-terminal";
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-claude-agent-terminal",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn(turnId, sessionId, "delegate audit");
    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        type: "acp.extension_notification",
        method: "_claude/sdkMessage",
        params: {
          message: {
            type: "system",
            subtype: "task_started",
            task_id: "agent-task-terminal",
            tool_use_id: "toolu-agent-terminal",
            description: "Audit renderer event handling",
            subagent_type: "Explore",
            task_type: "local_agent",
          },
        },
      },
    });
    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        type: "acp.extension_notification",
        method: "_claude/sdkMessage",
        params: {
          message: {
            type: "system",
            subtype: "task_notification",
            task_id: "agent-task-terminal",
            tool_use_id: "toolu-agent-terminal",
            status: "completed",
            output_file: "/tmp/agent-task-terminal.output",
            summary: "Agent completed",
            usage: {
              total_tokens: 4_321,
              tool_uses: 9,
              duration_ms: 12_500,
            },
          },
        },
      },
    });

    expect(store.subagentsFor(sessionId)).toEqual([
      expect.objectContaining({
        childSessionId: "agent-task-terminal",
        status: "complete",
        native: expect.objectContaining({
          progress: expect.objectContaining({
            usage: {
              totalTokens: 4_321,
              toolUses: 9,
              durationMs: 12_500,
            },
          }),
        }),
      }),
    ]);
    expect(store.openmaEventsFor(sessionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "work_item.progress",
          work_item_id: "agent-task-terminal",
        }),
        expect.objectContaining({
          type: "work_item.completed",
          work_item_id: "agent-task-terminal",
          data: expect.objectContaining({ kind: "agent" }),
        }),
      ]),
    );
  });

  it("reconciles Claude background membership without inventing a terminal status", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-claude-background-level",
      acp_session_id: "acp-claude-background-level",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn(
      "turn-background-level",
      "sess-claude-background-level",
      "watch CI",
    );
    store.apply({
      type: "session.event",
      session_id: "sess-claude-background-level",
      turn_id: "turn-background-level",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "monitor-level-call",
        status: "pending",
        rawInput: {
          description: "Watch CI status",
          command: "gh run watch",
          timeout_ms: 300_000,
          persistent: false,
        },
        _meta: { claudeCode: { toolName: "Monitor" } },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-claude-background-level",
      turn_id: "turn-background-level",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "monitor-level-call",
        status: "completed",
        _meta: {
          claudeCode: {
            toolName: "Monitor",
            toolResponse: {
              taskId: "monitor-level-task",
              timeoutMs: 300_000,
              persistent: false,
            },
          },
        },
      },
    });

    store.apply({
      type: "session.event",
      session_id: "sess-claude-background-level",
      turn_id: "turn-background-level",
      event: {
        type: "acp.extension_notification",
        method: "_claude/sdkMessage",
        params: {
          sessionId: "acp-claude-background-level",
          message: {
            type: "system",
            subtype: "background_tasks_changed",
            tasks: [],
            uuid: "00000000-0000-4000-8000-000000000071",
            session_id: "sdk-claude-background-level",
          },
        },
      },
    });

    expect(store.workItemsFor("sess-claude-background-level")).toEqual([
      expect.objectContaining({
        id: "monitor-level-task",
        kind: "monitor",
        status: "unknown",
        missing_terminal: true,
        reason: "absent_from_background_level",
      }),
    ]);
    expect(store.openmaEventsFor("sess-claude-background-level")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "work_item.missing_terminal",
          work_item_id: "monitor-level-task",
        }),
      ]),
    );

    store.apply({
      type: "session.event",
      session_id: "sess-claude-background-level",
      turn_id: "turn-background-level",
      event: {
        type: "acp.extension_notification",
        method: "_claude/sdkMessage",
        params: {
          sessionId: "acp-claude-background-level",
          message: {
            type: "system",
            subtype: "task_notification",
            task_id: "monitor-level-task",
            status: "completed",
            output_file: "/tmp/monitor-level-task.output",
            summary: "Monitor exited with code 0",
            uuid: "00000000-0000-4000-8000-000000000072",
            session_id: "sdk-claude-background-level",
          },
        },
      },
    });

    expect(store.workItemsFor("sess-claude-background-level")).toEqual([
      expect.objectContaining({
        id: "monitor-level-task",
        kind: "monitor",
        status: "completed",
        missing_terminal: false,
      }),
    ]);
  });

  it("repairs a missed Claude background start from the non-agent level rows", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-claude-level-repair",
      acp_session_id: "acp-claude-level-repair",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn(
      "turn-level-repair",
      "sess-claude-level-repair",
      "observe background work",
    );

    const applyLevel = (
      uuid: string,
      tasks: Array<Record<string, unknown>>,
    ) => store.apply({
      type: "session.event" as const,
      session_id: "sess-claude-level-repair",
      turn_id: "turn-level-repair",
      event: {
        type: "acp.extension_notification",
        method: "_claude/sdkMessage",
        params: {
          sessionId: "acp-claude-level-repair",
          message: {
            type: "system",
            subtype: "background_tasks_changed",
            tasks,
            uuid,
            session_id: "sdk-claude-level-repair",
          },
        },
      },
    });

    applyLevel("00000000-0000-4000-8000-000000000081", [
      {
        task_id: "level-local-task",
        task_type: "local_bash",
        description: "Watch deployment status",
      },
      {
        task_id: "level-agent-task",
        task_type: "local_agent",
        description: "Review deployment",
      },
    ]);

    expect(store.workItemsFor("sess-claude-level-repair")).toEqual([
      expect.objectContaining({
        id: "level-local-task",
        kind: "other",
        title: "Watch deployment status",
        status: "running",
      }),
    ]);

    applyLevel("00000000-0000-4000-8000-000000000082", []);
    expect(store.workItemsFor("sess-claude-level-repair")).toEqual([
      expect.objectContaining({
        id: "level-local-task",
        status: "unknown",
        missing_terminal: true,
      }),
    ]);

    applyLevel("00000000-0000-4000-8000-000000000083", [{
      task_id: "level-local-task",
      task_type: "local_bash",
      description: "Watch deployment status",
    }]);
    expect(store.workItemsFor("sess-claude-level-repair")).toEqual([
      expect.objectContaining({
        id: "level-local-task",
        kind: "other",
        status: "running",
        missing_terminal: false,
      }),
    ]);
  });

  it("persists a raw Claude Monitor notification with its stable work-item id", () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      backchat: { sessionPersistCanonicalEvent: persist },
    });
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-claude-monitor-event",
      acp_session_id: "acp-claude-monitor-event",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn(
      "turn-monitor-event",
      "sess-claude-monitor-event",
      "watch deploy errors",
    );

    store.apply({
      type: "session.event",
      session_id: "sess-claude-monitor-event",
      turn_id: "turn-monitor-event",
      event: {
        type: "acp.extension_notification",
        method: "_claude/sdkMessage",
        params: {
          sessionId: "acp-claude-monitor-event",
          message: {
            type: "user",
            origin: { kind: "task-notification" },
            message: {
              role: "user",
              content:
                "<task-notification>\n"
                + "<task-id>monitor-task-1</task-id>\n"
                + "<summary>Monitor event: \"errors in deploy.log\"</summary>\n"
                + "<event>ERROR timeout</event>\n"
                + "If this event is actionable, tell the user.\n"
                + "</task-notification>",
            },
          },
        },
      },
    });

    const monitorEvent = store.openmaEventsFor("sess-claude-monitor-event")
      .find((event) => event.type === "monitor.event");
    expect(monitorEvent).toMatchObject({
      type: "monitor.event",
      session_id: "sess-claude-monitor-event",
      turn_id: "turn-monitor-event",
      work_item_id: "monitor-task-1",
      data: {
        description: "errors in deploy.log",
        text: "ERROR timeout",
      },
    });
    expect(store.workItemsFor("sess-claude-monitor-event")).toEqual([]);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "monitor.event",
        work_item_id: "monitor-task-1",
      }),
    );
  });

  it("classifies the matching generic Claude local_bash item as Monitor on delivery", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-claude-monitor-classification",
      acp_session_id: "acp-claude-monitor-classification",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn(
      "turn-monitor-classification",
      "sess-claude-monitor-classification",
      "watch deployment status",
    );

    store.apply({
      type: "session.event",
      session_id: "sess-claude-monitor-classification",
      turn_id: "turn-monitor-classification",
      event: {
        type: "acp.extension_notification",
        method: "_claude/sdkMessage",
        params: {
          message: {
            type: "system",
            subtype: "task_started",
            task_id: "monitor-task-identity",
            task_type: "local_bash",
            description: "Watch deployment status",
            uuid: "00000000-0000-4000-8000-000000000091",
            session_id: "sdk-session-1",
          },
        },
      },
    });
    expect(store.workItemsFor("sess-claude-monitor-classification")).toEqual([
      expect.objectContaining({
        id: "monitor-task-identity",
        kind: "other",
        status: "running",
      }),
    ]);

    store.apply({
      type: "session.event",
      session_id: "sess-claude-monitor-classification",
      turn_id: "turn-monitor-classification",
      event: {
        type: "acp.extension_notification",
        method: "_claude/sdkMessage",
        params: {
          message: {
            type: "user",
            origin: { kind: "task-notification" },
            message: {
              role: "user",
              content:
                "<task-notification>\n"
                + "<task-id>monitor-task-identity</task-id>\n"
                + "<summary>Monitor event: \"Watch deployment status\"</summary>\n"
                + "<event>deployment failed</event>\n"
                + "</task-notification>",
            },
          },
        },
      },
    });

    expect(store.workItemsFor("sess-claude-monitor-classification")).toEqual([
      expect.objectContaining({
        id: "monitor-task-identity",
        kind: "monitor",
        status: "running",
        title: "Watch deployment status",
      }),
    ]);
    const lifecycle = store.openmaEventsFor("sess-claude-monitor-classification")
      .filter((event) => event.work_item_id === "monitor-task-identity")
      .map((event) => event.type);
    expect(lifecycle).toContain("work_item.classified");
    expect(lifecycle.filter((type) => type === "work_item.started")).toHaveLength(1);
  });

  it("keeps an out-of-band Monitor delivery at session scope after its source turn ends", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-persistent-monitor",
      acp_session_id: "acp-persistent-monitor",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });

    store.apply({
      type: "session.event",
      session_id: "sess-persistent-monitor",
      turn_id: "",
      event: {
        type: "acp.extension_notification",
        method: "_claude/sdkMessage",
        params: {
          message: {
            type: "user",
            origin: { kind: "task-notification" },
            message: {
              role: "user",
              content:
                "<task-notification>\n"
                + "<task-id>persistent-monitor-1</task-id>\n"
                + "<summary>Monitor event: \"production alerts\"</summary>\n"
                + "<event>latency threshold crossed</event>\n"
                + "</task-notification>",
            },
          },
        },
      },
    });

    const monitorEvent = store.openmaEventsFor("sess-persistent-monitor")
      .find((event) => event.type === "monitor.event");
    expect(monitorEvent).toMatchObject({
      session_id: "sess-persistent-monitor",
      work_item_id: "persistent-monitor-1",
      data: {
        description: "production alerts",
        text: "latency threshold crossed",
      },
    });
    expect(monitorEvent).not.toHaveProperty("turn_id");
  });

  it("keeps legacy Kimi notification-shaped text as assistant content without inferring background work", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-kimi-background",
      acp_session_id: "acp-kimi-background",
      agent_id: "kimi-code-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn(
      "turn-kimi-notification",
      "sess-kimi-background",
      "continue",
    );

    store.apply({
      type: "session.event",
      session_id: "sess-kimi-background",
      turn_id: "turn-kimi-notification",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "[Notification] Background task completed: build project\n"
            + "Task ID: b1234567\n"
            + "Status: completed\n"
            + "Description: build project",
        },
      },
    });

    expect(store.workItemsFor("sess-kimi-background")).toEqual([]);
    expect(store.subagentsFor("sess-kimi-background")).toEqual([]);
    expect(store.turnsFor("sess-kimi-background")[0]?.assistantText).toBe(
      "[Notification] Background task completed: build project\n"
        + "Task ID: b1234567\n"
        + "Status: completed\n"
        + "Description: build project",
    );
  });

  it("marks an unfinished Codex child unknown when its parent turn ends without a child terminal event", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-codex-child",
      acp_session_id: "acp-codex-child",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-codex-child", "sess-codex-child", "delegate audit");
    store.apply({
      type: "session.event",
      session_id: "sess-codex-child",
      turn_id: "turn-codex-child",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "spawn-child",
        title: "spawn_agent",
        kind: "other",
        status: "completed",
        rawInput: {
          prompt: "Audit the adapter",
          senderThreadId: "parent-thread",
          receiverThreadIds: ["child-thread"],
          agentsStates: {
            "child-thread": { status: "running", message: null },
          },
        },
        _meta: {
          codex: {
            collaboration: {
              tool: "spawn_agent",
              senderThreadId: "parent-thread",
              receiverThreadIds: ["child-thread"],
            },
          },
        },
      },
    });

    expect(store.workItemsFor("sess-codex-child")).toEqual([
      expect.objectContaining({
        id: "child-thread",
        kind: "agent",
        status: "running",
      }),
    ]);

    store.apply({
      type: "session.complete",
      session_id: "sess-codex-child",
      turn_id: "turn-codex-child",
    });

    expect(store.workItemsFor("sess-codex-child")).toEqual([
      expect.objectContaining({
        id: "child-thread",
        kind: "agent",
        status: "unknown",
        missing_terminal: true,
        reason: "parent_turn_completed",
      }),
    ]);
  });

  it("preserves canonical completion and passthrough lifecycle for pair members", () => {
    const store = new SessionStore();
    store.applyPair({
      type: "pair.ready",
      pair_id: "pair-canonical",
      members: [{
        session_id: "pair-member",
        acp_session_id: "acp-pair-member",
        agent_id: "codex-acp",
        cwd: "/tmp/project",
      }],
    });
    const targets = store.registerPairTurn("pair-canonical", "run tests");
    const turnId = targets?.[0]?.turn_id ?? "missing-turn";

    const background = createOpenMAEvent({
      event_id: "pair-background-started",
      type: "work_item.started",
      session_id: "pair-member",
      turn_id: turnId,
      work_item_id: "pair-terminal",
      source: { kind: "harness", harness: "codex-acp", adapter: "acp-terminal" },
      occurred_at: "2026-08-05T00:00:00.000Z",
      data: { kind: "bash", title: "pnpm test" },
    });
    store.applyPair({
      type: "pair.session_event",
      pair_id: "pair-canonical",
      member_session_id: "pair-member",
      session_event: {
        type: "session.background_process",
        session_id: "pair-member",
        process_id: "pair-terminal",
        seq: 1,
        phase: "started",
        command: "pnpm",
        args: ["test"],
        openma_event: background,
      },
    });
    expect(store.workItemsFor("pair-member")).toEqual([
      expect.objectContaining({
        id: "pair-terminal",
        kind: "bash",
        status: "running",
        title: "pnpm test",
      }),
    ]);

    const completed = createOpenMAEvent({
      event_id: "pair-turn-completed",
      type: "turn.completed",
      session_id: "pair-member",
      turn_id: turnId,
      source: { kind: "harness", harness: "codex-acp", adapter: "acp" },
      occurred_at: "2026-08-05T00:00:01.000Z",
      data: { stop_reason: "end_turn" },
    });
    store.applyPair({
      type: "pair.complete",
      pair_id: "pair-canonical",
      member_session_id: "pair-member",
      turn_id: turnId,
      stop_reason: "end_turn",
      openma_event: completed,
    });

    expect(store.openmaEventsFor("pair-member")).toEqual(
      expect.arrayContaining([background, completed]),
    );
    expect(store.turnsFor("pair-member")[0]?.status).toBe("complete");
    expect(store.pair("pair-canonical")?.pendingMembers).toBeUndefined();
  });

  it("preserves canonical error evidence for a pair member", () => {
    const store = new SessionStore();
    store.applyPair({
      type: "pair.ready",
      pair_id: "pair-error",
      members: [{
        session_id: "pair-error-member",
        acp_session_id: "acp-pair-error-member",
        agent_id: "claude-acp",
        cwd: "/tmp/project",
      }],
    });
    const failure = createOpenMAEvent({
      event_id: "pair-member-session-error",
      type: "session.error",
      session_id: "pair-error-member",
      source: { kind: "harness", harness: "claude-acp", adapter: "acp" },
      occurred_at: "2026-08-05T00:00:00.000Z",
      data: { message: "Authentication required" },
    });

    store.applyPair({
      type: "pair.error",
      pair_id: "pair-error",
      member_session_id: "pair-error-member",
      message: "Authentication required",
      code: "auth_required",
      agent_id: "claude-acp",
      openma_event: failure,
    });

    expect(store.openmaEventsFor("pair-error-member")).toContainEqual(failure);
    expect(store.get("pair-error-member")).toMatchObject({
      status: "ready",
      authRequired: true,
      lastError: undefined,
      auth: { status: "needs-auth", message: "Authentication required" },
    });
  });
});

describe("SessionStore turn-scoped provider errors", () => {
  // Recorded from sess-drglvie2: a provider capacity error ends one turn with
  // a turn-scoped session.error and no turn.failed. The ACP session is fine.
  const sessionId = "sess-turn-error";
  const source = { kind: "harness", harness: "pi-acp", adapter: "acp" } as const;
  const userMessage = createOpenMAEvent({
    event_id: "turn-error-user",
    type: "user.message",
    session_id: sessionId,
    turn_id: "turn-capacity",
    source,
    occurred_at: "2026-10-13T13:41:13.000Z",
    data: { text: "continue", input_kind: "prompt" },
  });
  const capacityError = createOpenMAEvent({
    event_id: "turn-error-session-error",
    type: "session.error",
    session_id: sessionId,
    turn_id: "turn-capacity",
    source,
    occurred_at: "2026-10-13T13:41:19.000Z",
    data: {
      message: "Internal error: Devin stream error: We are currently experiencing capacity issues with this serving model.",
      error_details: { code: -32603, data: { pi: { assistantError: true, failure: "unknown" } } },
    },
  });
  const ready = {
    type: "session.ready",
    session_id: sessionId,
    acp_session_id: "acp-turn-error",
    agent_id: "pi-acp",
    cwd: "/tmp/project",
  } as const;

  it("keeps the chat usable when history ends in a turn-scoped error", () => {
    const store = new SessionStore();
    store.apply(ready);
    store.replayHistory(sessionId, [userMessage, capacityError].map((event, index) => ({
      seq: index + 1,
      type: "openma_event",
      data: JSON.stringify(event),
      ts: index + 1,
    })));

    expect(store.turnsFor(sessionId).map((turn) => turn.status)).toEqual(["error"]);
    expect(store.get(sessionId)?.status).toBe("ready");
  });

  it("keeps the chat usable when a live turn ends in a turn-scoped error", () => {
    const store = new SessionStore();
    store.apply(ready);
    store.apply({ type: "session.event", session_id: sessionId, turn_id: "turn-capacity", openma_event: userMessage } as never);
    store.apply({ type: "session.event", session_id: sessionId, turn_id: "turn-capacity", openma_event: capacityError } as never);

    expect(store.get(sessionId)?.status).not.toBe("errored");
  });

  it("still locks the chat for a session-wide error", () => {
    const store = new SessionStore();
    store.apply(ready);
    const { turn_id: _turn, ...sessionWide } = capacityError;
    store.replayHistory(sessionId, [{
      seq: 1,
      type: "openma_event",
      data: JSON.stringify({ ...sessionWide, data: { message: "agent binary missing" } }),
      ts: 1,
    }]);

    expect(store.get(sessionId)).toMatchObject({ status: "errored", lastError: "agent binary missing" });
  });
});

describe("SessionStore replay of a legacy prompt row with canonical turn content", () => {
  // Histories written before the canonical user.message existed (and the
  // fixtures that model them) open the turn with a bare `user_prompt` row,
  // which carries no turn id. The canonical rows that follow carry the host
  // turn id, and must still land on the turn that prompt opened.
  const sessionId = "sess-legacy-prompt";
  const turnId = "turn-legacy-prompt";
  const source = { kind: "harness", harness: "claude-acp", adapter: "acp" } as const;
  const canonical = (eventId: string, type: string, data: Record<string, unknown>) => ({
    schema: "oma.event.v1",
    event_id: eventId,
    session_id: sessionId,
    turn_id: turnId,
    source,
    occurred_at: "2026-08-06T00:00:00.000Z",
    type,
    data,
  });

  it("keeps the canonical thought, text and terminal on the prompt's turn", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-legacy-prompt",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    const rows = [
      { type: "user_prompt", data: { text: "calculate" } },
      { type: "openma_event", data: canonical("t1", "agent.thinking", { text: "37 + 58", message_id: "m" }) },
      { type: "openma_event", data: canonical("t2", "agent.thinking", { text: " = 95.", message_id: "m" }) },
      { type: "openma_event", data: canonical("a1", "agent.message_chunk", { text: "95", message_id: "m" }) },
      { type: "openma_event", data: canonical("done", "turn.completed", { stop_reason: "end_turn" }) },
    ];
    store.replayHistory(sessionId, rows.map((row, index) => ({
      seq: index + 1,
      type: row.type,
      data: JSON.stringify(row.data),
      ts: index + 1,
    })));

    const turns = store.turnsFor(sessionId);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      promptText: "calculate",
      thoughtText: "37 + 58 = 95.",
      assistantText: "95",
      status: "complete",
      stopReason: "end_turn",
    });
  });
});

type RecordedEvent = {
  seq: number;
  type: string;
  event_id?: string;
  session_id?: string;
  turn_id?: string;
  occurred_at?: string;
  data: Record<string, unknown>;
  raw?: { payload?: unknown };
};

function recordedGuardianEvents(): RecordedEvent[] {
  return JSON.parse(
    readFileSync(
      resolve(__dirname, "__fixtures__/sess-guardian-interleave.anon.json"),
      "utf8",
    ),
  ) as RecordedEvent[];
}

function routedTurnId(event: RecordedEvent): string | undefined {
  if (
    event.type === "user.message"
    && event.data.input_kind === "steering"
    && event.data.outcome === "injected"
    && typeof event.data.active_turn_id === "string"
  ) {
    return event.data.active_turn_id;
  }
  return event.turn_id;
}

function firstArrivalTimelineKeys(
  events: readonly RecordedEvent[],
  turnId: string,
): string[] {
  const items: string[] = [];
  const seenTools = new Set<string>();
  let openSegment: string | undefined;
  for (const event of events) {
    if (routedTurnId(event) !== turnId) continue;
    if (
      event.type === "user.message"
      && event.data.input_kind === "steering"
      && event.data.outcome === "injected"
    ) {
      items.push(`user_input:${event.turn_id}`);
      openSegment = undefined;
      continue;
    }
    if (event.type === "agent.thinking" || event.type === "agent.message_chunk") {
      const key = [
        event.type,
        typeof event.data.message_id === "string" ? event.data.message_id : "anonymous",
        typeof event.data.phase === "string" ? event.data.phase : "",
      ].join(":");
      if (key !== openSegment) {
        items.push(`segment:${event.type}`);
        openSegment = key;
      }
      continue;
    }
    if (event.type.startsWith("tool.")) {
      const toolCallId = event.data.tool_call_id;
      if (typeof toolCallId !== "string") continue;
      if (!seenTools.has(toolCallId)) {
        items.push(`tool:${toolCallId}`);
        seenTools.add(toolCallId);
        openSegment = undefined;
      }
    }
  }
  return items;
}

function projectedTimelineKeys(timeline: ReturnType<typeof reduceTurn>["timeline"]): string[] {
  return timeline.map((item) => {
    if (item.kind === "tool") return `tool:${item.toolCallId}`;
    if (item.kind === "user_input") return `user_input:${item.clientId}`;
    return item.kind === "thought"
      ? "segment:agent.thinking"
      : "segment:agent.message_chunk";
  });
}

/** Drive the live reducer with the same events, as main would push them. */
function liveStoreFrom(events: readonly RecordedEvent[], sessionId: string): SessionStore {
  const live = new SessionStore();
  live.apply({
    type: "session.ready",
    session_id: sessionId,
    acp_session_id: "acp-fixture",
    agent_id: "codex-acp",
    cwd: "/fixture",
  });

  for (const event of events) {
    const data = event.data;
    if (event.type === "user.message" && data.input_kind === "prompt") {
      live.registerTurn(
        event.turn_id!,
        sessionId,
        typeof data.text === "string" ? data.text : "",
      );
    } else if (
      event.type === "user.message"
      && data.input_kind === "steering"
      && data.outcome === "injected"
    ) {
      live.apply({
        type: "session.steering",
        session_id: sessionId,
        turn_id: event.turn_id!,
        active_turn_id: String(data.active_turn_id),
        text: String(data.text ?? ""),
        requested_delivery: "llm_boundary",
        effective_delivery: "llm_boundary",
        outcome: "injected",
        openma_event: event,
      } as Parameters<SessionStore["apply"]>[0]);
    } else if (event.type === "turn.completed") {
      live.apply({
        type: "session.complete",
        session_id: sessionId,
        turn_id: event.turn_id!,
        stop_reason: typeof data.stop_reason === "string"
          ? data.stop_reason
          : undefined,
      });
    } else if (
      event.turn_id
      && (event.type.startsWith("agent.") || event.type.startsWith("tool.") || event.type.startsWith("plan."))
    ) {
      live.apply(attachOpenMAEvent({
        type: "session.event",
        session_id: sessionId,
        turn_id: event.turn_id,
        event: event.raw?.payload ?? event,
      }, event as never));
    }
  }
  return live;
}

describe("SessionStore recorded Guardian interleave", () => {
  it("replays prompt turns and steers in first-arrival order with stable tool positions", () => {
    const events = recordedGuardianEvents().sort((a, b) => a.seq - b.seq);
    const sessionId = "sess_fixture";
    const rows = events.map((event) => ({
      seq: event.seq,
      type: "openma_event",
      data: JSON.stringify(event),
      ts: Date.parse(event.occurred_at ?? "") || event.seq,
    }));
    const replayed = new SessionStore();
    replayed.replayHistory(sessionId, rows);
    const turns = replayed.turnsFor(sessionId);
    const promptTurnIds = events
      .filter((event) =>
        event.type === "user.message" && event.data.input_kind === "prompt"
      )
      .map((event) => event.turn_id);

    expect(turns.map((turn) => turn.id)).toEqual(promptTurnIds);
    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.status)).toEqual(["complete", "complete"]);
    for (const turn of turns) {
      const rendered = replayed.projectTurn(turn);
      const expected = firstArrivalTimelineKeys(events, turn.id);
      expect(projectedTimelineKeys(rendered.timeline)).toEqual(expected);
      expect(new Set(rendered.tools.map((tool) => tool.toolCallId)).size)
        .toBe(rendered.tools.length);
      expect(rendered.tools.map((tool) => `tool:${tool.toolCallId}`))
        .toEqual(expected.filter((key) => key.startsWith("tool:")));
    }

    const steers = events.filter((event) =>
      event.type === "user.message"
      && event.data.input_kind === "steering"
      && event.data.outcome === "injected"
    );
    const activeTurnId = String(steers[0]?.data.active_turn_id);
    const activeTurn = turns.find((turn) => turn.id === activeTurnId)!;
    const activeTimeline = replayed.projectTurn(activeTurn).timeline;
    const userInputs = activeTimeline.filter((item) => item.kind === "user_input");
    expect(userInputs.map((item) => item.kind === "user_input" ? item.clientId : ""))
      .toEqual(steers.map((event) => event.turn_id));
    expect(activeTimeline.filter((item) => item.kind === "tool").map((item) => item.toolCallId))
      .toContain("guardian_assessment:call_55a19ca7a0");
    expect(
      replayed.projectTurn(activeTurn).tools
        .filter((tool) => tool.title === "Guardian Review")
        .map((tool) => tool.toolCallId),
    ).toContain("guardian_assessment:call_55a19ca7a0");
  });

  it("matches live incremental projection with replay and keeps the footer boundary terminal", () => {
    const events = recordedGuardianEvents().sort((a, b) => a.seq - b.seq);
    const sessionId = "sess_fixture";
    const rows = events.map((event) => ({
      seq: event.seq,
      type: "openma_event",
      data: JSON.stringify(event),
      ts: Date.parse(event.occurred_at ?? "") || event.seq,
    }));
    const replayed = new SessionStore();
    replayed.replayHistory(sessionId, rows);
    const live = liveStoreFrom(events, sessionId);

    const replayedTurns = replayed.turnsFor(sessionId);
    const liveTurns = live.turnsFor(sessionId);
    expect(liveTurns.map((turn) => turn.id)).toEqual(replayedTurns.map((turn) => turn.id));
    for (const replayedTurn of replayedTurns) {
      const liveTurn = liveTurns.find((turn) => turn.id === replayedTurn.id)!;
      expect(live.projectTurn(liveTurn)).toEqual(replayed.projectTurn(replayedTurn));
    }

    const unfinished = new SessionStore();
    unfinished.replayHistory(
      sessionId,
      rows.filter((row) => {
        const event = JSON.parse(row.data) as RecordedEvent;
        return !(event.type === "turn.completed" && event.turn_id === "turn_ab678cc0d5");
      }),
    );
    expect(
      unfinished.turnsFor(sessionId).find((turn) => turn.id === "turn_ab678cc0d5")?.status,
    ).toBe("running");
    expect(replayed.turnsFor(sessionId).find((turn) => turn.id === "turn_ab678cc0d5")?.status)
      .toBe("complete");
  });
});

/** Seeded PRNG so a failing seed reproduces exactly. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T,>(items: readonly T[]): T => items[int(0, items.length - 1)]!;
  return { next, int, pick };
}

const CHAOS_TOKENS = ["#104", "4", "00", "\n\n", "表格", " ", "x", "**粗**", "`code`", "| a |", "🙂", "done."];

/** A random but well-formed Codex-like session: thoughts, commentary,
 *  long-running and Guardian tools that finish out of order, injected
 *  steers, then a final answer and the terminal. */
function chaosSession(seed: number): RecordedEvent[] {
  const rng = seededRandom(seed);
  const events: RecordedEvent[] = [];
  let seq = 0;
  const push = (turnId: string, type: string, data: Record<string, unknown>) => {
    seq += 1;
    events.push({
      schema: "oma.event.v1",
      schema_version: "oma.event.v1",
      event_id: `evt-${seed}-${seq}`,
      session_id: "sess_chaos",
      turn_id: turnId,
      source: { kind: "harness", harness: "codex", adapter: "acp" },
      occurred_at: new Date(1_800_000_000_000 + seq).toISOString(),
      type,
      data,
      seq,
    } as RecordedEvent);
  };
  const run = (turnId: string, type: "agent.thinking" | "agent.message_chunk", messageId: string, phase?: string) => {
    for (let i = rng.int(1, 6); i > 0; i--) {
      const text = rng.pick(CHAOS_TOKENS);
      push(turnId, type, {
        text,
        content: { type: "text", text },
        message_id: messageId,
        ...(phase ? { phase } : {}),
      });
    }
  };
  for (let turn = 0, turns = rng.int(1, 3); turn < turns; turn++) {
    const turnId = `turn-${seed}-${turn}`;
    push(turnId, "user.message", { text: `prompt ${turn}`, input_kind: "prompt" });
    push(turnId, "session.running", { thread_status: { type: "active", activeFlags: [] } });
    const open: string[] = [];
    let message = 0;
    let tool = 0;
    for (let step = rng.int(3, 20); step > 0; step--) {
      const action = rng.pick(["thought", "thought", "commentary", "commentary", "tool", "guardian", "finish", "progress", "steer"]);
      if (action === "thought") run(turnId, "agent.thinking", `th-${turn}-${message++}`);
      else if (action === "commentary") run(turnId, "agent.message_chunk", `msg-${turn}-${message++}`, "commentary");
      else if (action === "tool" || action === "guardian") {
        const id = action === "guardian"
          ? `guardian_assessment:call-${turn}-${tool++}`
          : `call-${turn}-${tool++}`;
        push(turnId, "tool.started", {
          tool_call_id: id,
          title: action === "guardian" ? "Guardian Review" : "Tool",
          kind: action === "guardian" ? "think" : "execute",
          status: "in_progress",
        });
        open.push(id);
      } else if ((action === "finish" || action === "progress") && open.length) {
        const index = rng.int(0, open.length - 1);
        const id = open[index]!;
        if (action === "progress") push(turnId, "tool.progress", { tool_call_id: id });
        else {
          open.splice(index, 1);
          push(turnId, rng.next() < 0.8 ? "tool.completed" : "tool.failed", {
            tool_call_id: id,
            status: "completed",
            outcome: "ok",
          });
        }
      } else if (action === "steer") {
        push(`steer-${seed}-${seq}`, "user.message", {
          text: "steer",
          input_kind: "steering",
          active_turn_id: turnId,
          prompt_intent: "steer",
          requested_delivery: "llm_boundary",
          effective_delivery: "llm_boundary",
          delivery_degraded: false,
          outcome: "injected",
        });
      }
    }
    for (const id of open) push(turnId, "tool.completed", { tool_call_id: id, status: "completed", outcome: "ok" });
    run(turnId, "agent.message_chunk", `final-${turn}`, "final_answer");
    push(turnId, "session.idle", { thread_status: { type: "idle" } });
    push(turnId, "turn.completed", { stop_reason: "end_turn" });
  }
  return events;
}

/** Text of each projected segment, in first-arrival order: chunks of one
 *  uninterrupted run concatenate verbatim. */
function firstArrivalSegmentTexts(events: readonly RecordedEvent[], turnId: string): string[] {
  const texts: string[] = [];
  let openSegment: string | undefined;
  for (const event of events) {
    if (routedTurnId(event) !== turnId) continue;
    if (event.type === "agent.thinking" || event.type === "agent.message_chunk") {
      const key = [event.type, event.data.message_id, event.data.phase ?? ""].join(":");
      if (key !== openSegment) texts.push("");
      texts[texts.length - 1] += String(event.data.text);
      openSegment = key;
    } else if (event.type === "user.message" && event.data.input_kind === "steering") {
      openSegment = undefined;
    } else if (event.type === "tool.started") {
      openSegment = undefined;
    }
  }
  return texts;
}

describe("SessionStore chaos: block order and text across live and replay", () => {
  it("keeps human reading order, verbatim text and a terminal footer for random sessions", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const events = chaosSession(seed);
      const sessionId = "sess_chaos";
      const rows = events.map((event) => ({
        seq: event.seq,
        type: "openma_event",
        data: JSON.stringify(event),
        ts: event.seq,
      }));
      const replayed = new SessionStore();
      replayed.replayHistory(sessionId, rows);
      const live = liveStoreFrom(events, sessionId);
      const promptTurnIds = events
        .filter((event) => event.type === "user.message" && event.data.input_kind === "prompt")
        .map((event) => event.turn_id);

      expect(replayed.turnsFor(sessionId).map((turn) => turn.id), `seed ${seed}: replay turns`)
        .toEqual(promptTurnIds);
      expect(live.turnsFor(sessionId).map((turn) => turn.id), `seed ${seed}: live turns`)
        .toEqual(promptTurnIds);
      for (const turnId of promptTurnIds) {
        const replayTurn = replayed.turnsFor(sessionId).find((turn) => turn.id === turnId)!;
        const liveTurn = live.turnsFor(sessionId).find((turn) => turn.id === turnId)!;
        const rendered = replayed.projectTurn(replayTurn);
        expect(projectedTimelineKeys(rendered.timeline), `seed ${seed} ${turnId}: order`)
          .toEqual(firstArrivalTimelineKeys(events, turnId!));
        expect(
          rendered.timeline
            .filter((item) => item.kind === "thought" || item.kind === "assistant_text")
            .map((item) => (item as { text: string }).text),
          `seed ${seed} ${turnId}: text`,
        ).toEqual(firstArrivalSegmentTexts(events, turnId!));
        // The final answer is the last block, after every tool and commentary.
        expect(rendered.timeline.at(-1), `seed ${seed} ${turnId}: final answer last`)
          .toMatchObject({ kind: "assistant_text", phase: "final_answer" });
        expect(replayTurn.status, `seed ${seed} ${turnId}: terminal`).toBe("complete");
        expect(live.projectTurn(liveTurn), `seed ${seed} ${turnId}: live equals replay`)
          .toEqual(rendered);
      }
    }
  });
});

/** Interleave the turns of a chaos session the way a queueing harness writes
 *  them (pi-acp): turn N+1 may open while turn N is still streaming, so a
 *  turn's tail — including its terminal — can land after later prompts.
 *  Openers keep their order; each turn keeps its own event order. Steers
 *  travel with the turn they are injected into. */
function interleavedChaosSession(seed: number): RecordedEvent[] {
  const rng = seededRandom(seed * 7919);
  const source = chaosSession(seed);
  const owner = (event: RecordedEvent) =>
    event.type === "user.message" && event.data.input_kind === "steering"
      ? String(event.data.active_turn_id)
      : event.turn_id!;
  const order: string[] = [];
  const queues = new Map<string, RecordedEvent[]>();
  for (const event of source) {
    const id = owner(event);
    if (!queues.has(id)) { queues.set(id, []); order.push(id); }
    queues.get(id)!.push(event);
  }
  const merged: RecordedEvent[] = [];
  let opened = 0;
  while (merged.length < source.length) {
    const eligible = order.filter((id, index) =>
      queues.get(id)!.length > 0 && index <= opened);
    const id = rng.pick(eligible);
    const event = queues.get(id)!.shift()!;
    if (order.indexOf(id) === opened && event.type === "user.message") opened += 1;
    merged.push(event);
  }
  return merged.map((event, index) => ({ ...event, seq: index + 1 }));
}

/** main's loadHistoryPage: the `limit` newest rows before `before`, grown
 *  back to the newest prompt opener at or before the oldest row unless that
 *  costs more than three extra pages. */
function pageRows(
  rows: readonly { seq: number; type: string; data: string; ts: number }[],
  limit: number,
  before?: number,
) {
  const older = rows.filter((row) => before === undefined || row.seq < before);
  const page = older.slice(-limit);
  const oldest = page[0];
  if (!oldest) return page;
  const opener = [...older].reverse().find((row) => {
    if (row.seq > oldest.seq) return false;
    const event = JSON.parse(row.data) as RecordedEvent;
    return event.type === "user.message" && event.data.input_kind === "prompt";
  });
  if (!opener || opener.seq >= oldest.seq) return page;
  const head = older.filter((row) => row.seq >= opener.seq && row.seq < oldest.seq);
  return head.length > limit * 3 ? page : [...head, ...page];
}

describe("SessionStore chaos: paging interleaved turns", () => {
  it("projects every turn the same whether the log is replayed whole or paged", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const events = interleavedChaosSession(seed);
      const sessionId = "sess_chaos";
      const rows = events.map((event) => ({
        seq: event.seq,
        type: "openma_event",
        data: JSON.stringify(event),
        ts: event.seq,
      }));
      const whole = new SessionStore();
      whole.replayHistory(sessionId, rows);
      const expected = whole.turnsFor(sessionId);

      const limit = seededRandom(seed * 104729).int(3, 40);
      const paged = new SessionStore();
      let page = pageRows(rows, limit);
      paged.replayHistoryWindow(sessionId, page, { hasMore: page.length >= limit });
      for (let guard = 0; page.length >= limit && guard < 1000; guard++) {
        page = pageRows(rows, limit, paged.historyWindowFor(sessionId)!.oldestSeq);
        paged.prependHistory(sessionId, page, { hasMore: page.length >= limit });
      }
      const actual = paged.turnsFor(sessionId);
      const label = `seed ${seed} (page ${limit})`;

      expect(actual.map((turn) => turn.id), `${label}: turns`)
        .toEqual(expected.map((turn) => turn.id));
      expect(actual.map((turn) => turn.status), `${label}: status`)
        .toEqual(expected.map((turn) => turn.status));
      for (const [index, turn] of actual.entries()) {
        expect(
          projectedTimelineKeys(paged.projectTurn(turn).timeline),
          `${label} ${turn.id}: blocks`,
        ).toEqual(projectedTimelineKeys(whole.projectTurn(expected[index]!).timeline));
      }
    }
  });
});
