import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SessionStore,
  selectSessions,
  selectTurnsFor,
  type AcpSessionConfigOption,
  type SubagentActivity,
} from "./session-store";
import { reduceTurn } from "./reduce-turn";
import { createOpenMAEvent } from "@openma/common/session-events/openma";

describe("session store module boundaries", () => {
  test("keeps public data contracts in a dedicated type module", () => {
    const source = readFileSync(resolve(__dirname, "session-store.ts"), "utf8");

    expect(source).toContain('from "./session-types"');
    expect(source).not.toContain("export interface SessionRow {");
    expect(source).not.toContain("export interface Turn {");
  });

  test("delegates workspace artifact parsing to a pure helper module", () => {
    const source = readFileSync(resolve(__dirname, "session-store.ts"), "utf8");

    expect(source).toContain('from "./session-artifacts"');
    expect(source).not.toContain("function extractFilePaths(");
    expect(source).not.toContain("function extractServiceUrls(");
  });

  test("delegates persisted side workspace normalization to a pure helper module", () => {
    const source = readFileSync(resolve(__dirname, "session-store.ts"), "utf8");

    expect(source).toContain('from "./session-workspace-normalization"');
    expect(source).not.toContain("function normalizeRestoredSideSession(");
    expect(source).not.toContain("function isPersistedSideTab(");
  });

  test("delegates native subagent status and provider mapping to a pure helper module", () => {
    const source = readFileSync(resolve(__dirname, "session-store.ts"), "utf8");

    expect(source).toContain('from "./session-native-activity"');
    expect(source).not.toContain("function nativeActivityTurnStatus(");
    expect(source).not.toContain("function resolveAgentRuntimeAdapter(");
  });

  test("depends on the runtime adapter contract instead of provider detectors", () => {
    const source = readFileSync(resolve(__dirname, "session-store.ts"), "utf8");

    expect(source).toContain('from "./agent-runtime-adapters"');
    expect(source).toContain("resolveAgentRuntimeAdapter");
    expect(source).toContain("genericAcpRuntimeAdapter");
    expect(source).not.toContain("detectNativeAgentToolEvent");
    expect(source).not.toContain("detectNativeAgentRawEvent");
    expect(source).not.toContain("nativeProviderForAgent");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const initialConfig: AcpSessionConfigOption[] = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "sonnet",
    options: [{ value: "sonnet", name: "Claude Sonnet" }],
  },
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: "code",
    options: [{ value: "code", name: "Code" }],
  },
];

describe("SessionStore replay", () => {
  test("replays repeated numeric thought chunks without dropping the equation", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-arithmetic";
    const turnId = "turn-replay-arithmetic";
    const chunks = [
      "The", " user", " is", " asking", " me", " to", " calculate", " ",
      "37", " +", " ", "58", " and", " output", " only", " \"", "CL",
      "AU", "DE", "_C", "U", "_OK", ":", " ", "95", "\".\n\n",
      "37", " +", " ", "58", " =", " ", "95", ".",
    ];
    const canonical = (text: string, index: number) => {
      const occurredAt = `2026-08-06T00:00:00.${String(index).padStart(3, "0")}Z`;
      const rawPayload = {
        content: { text, type: "text" },
        messageId: "60d8e901-4ea5-41a1-a810-d798e7715e83",
        sessionUpdate: "agent_thought_chunk",
      };
      return {
        schema: "oma.event.v1",
        event_id: `thought-${index}`,
        session_id: sessionId,
        turn_id: turnId,
        source: { kind: "harness", harness: "claude-acp", adapter: "acp" },
        occurred_at: occurredAt,
        type: "agent.thinking",
        data: {
          text,
          message_id: "60d8e901-4ea5-41a1-a810-d798e7715e83",
        },
        raw: {
          kind: "raw",
          source: "acp",
          method: "session/update",
          event_type: "agent_thought_chunk",
          payload: rawPayload,
          received_at: occurredAt,
          reason: "unknown",
        },
      };
    };

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "calculate" }),
        ts: 1000,
      },
      ...chunks.map((text, index) => ({
        seq: index + 2,
        type: "openma_event",
        data: JSON.stringify(canonical(text, index)),
        ts: 1001 + index,
      })),
    ]);

    const turn = store.turnsFor(sessionId)[0]!;
    expect(turn.thoughtText).toBe(
      'The user is asking me to calculate 37 + 58 and output only "CLAUDE_CU_OK: 95".\n\n37 + 58 = 95.',
    );
    expect(reduceTurn(turn.events).timeline).toEqual([{
      kind: "thought",
      messageId: "60d8e901-4ea5-41a1-a810-d798e7715e83",
      text: 'The user is asking me to calculate 37 + 58 and output only "CLAUDE_CU_OK: 95".\n\n37 + 58 = 95.',
    }]);
  });

  test("restores prompt attachments as task sources", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-attachments";
    const attachment = {
      id: "attachment-1",
      name: "reference.png",
      path: "/tmp/reference.png",
      uri: "file:///tmp/reference.png",
      kind: "image" as const,
      mimeType: "image/png",
    };

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Use this image", attachments: [attachment] }),
        ts: 1000,
      },
    ]);

    expect(store.turnsFor(sessionId)[0]?.attachments).toEqual([attachment]);
  });

  test("restores the latest session metadata and usage from history", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-replay-metadata",
      acp_session_id: "acp-replay-metadata",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });

    store.replayHistory("sess-replay-metadata", [
      {
        seq: 1,
        type: "session_info_update",
        data: JSON.stringify({
          sessionUpdate: "session_info_update",
          title: "Restored title",
          _meta: { codex: { threadStatus: { type: "idle" } } },
        }),
        ts: 1000,
      },
      {
        seq: 2,
        type: "usage_update",
        data: JSON.stringify({
          sessionUpdate: "usage_update",
          used: 80,
          size: 100,
        }),
        ts: 1001,
      },
    ]);

    expect(store.get("sess-replay-metadata")).toMatchObject({
      label: "Restored title",
      agentThreadStatus: "idle",
      usage: { used: 80, size: 100 },
    });
    expect(store.turnsFor("sess-replay-metadata")).toEqual([]);
  });

  test("replays persisted assistant chunks exactly once", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-history-dedupe";

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Generate an image" }),
        ts: 1000,
      },
      {
        seq: 2,
        type: "agent_message_chunk",
        data: JSON.stringify({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Rendered " },
        }),
        ts: 1001,
      },
      {
        seq: 3,
        type: "agent_message_chunk",
        data: JSON.stringify({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "once." },
        }),
        ts: 1002,
      },
    ]);

    expect(store.turnsFor(sessionId)).toHaveLength(1);
    expect(store.turnsFor(sessionId)[0]?.assistantText).toBe("Rendered once.");
  });

  test("restores a turn's end time from its final persisted event", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-duration";

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Do some work" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "agent_message_chunk",
        data: JSON.stringify({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Done." },
        }),
        ts: 4_600,
      },
    ]);

    expect(store.turnsFor(sessionId)[0]).toMatchObject({
      startedAt: 1_000,
      endedAt: 4_600,
    });
  });

  test("replays canonical transcript once and ignores duplicate raw evidence rows", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-canonical-transcript";
    const turnId = "turn-replay-canonical-transcript";
    const rawEvent = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "once" },
    };
    const canonical = createOpenMAEvent({
      event_id: "canonical-message-once",
      type: "agent.message_chunk",
      session_id: sessionId,
      turn_id: turnId,
      source: { kind: "harness", harness: "claude-acp", adapter: "acp" },
      occurred_at: "2026-08-05T00:00:01.000Z",
      seq: 2,
      data: { text: "once" },
      raw: {
        kind: "raw",
        source: "acp",
        method: "session/update",
        event_type: "agent_message_chunk",
        payload: rawEvent,
        received_at: "2026-08-05T00:00:01.000Z",
        reason: "unknown",
      },
    });
    const promptData = { text: "replay this", attachments: undefined };
    const canonicalPrompt = createOpenMAEvent({
      event_id: "canonical-prompt-once",
      type: "user.message",
      session_id: sessionId,
      turn_id: turnId,
      source: { kind: "user" },
      occurred_at: "2026-08-05T00:00:00.500Z",
      data: { ...promptData, input_kind: "prompt" },
      raw: {
        kind: "raw",
        source: "transport",
        event_type: "user_prompt",
        payload: promptData,
        received_at: "2026-08-05T00:00:00.500Z",
        reason: "unknown",
      },
    });

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "replay this" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "openma_event",
        data: JSON.stringify(canonicalPrompt),
        ts: 1_500,
      },
      {
        seq: 3,
        type: "openma_event",
        data: JSON.stringify(canonical),
        ts: 2_000,
      },
      {
        seq: 4,
        type: "agent_message_chunk",
        data: JSON.stringify(rawEvent),
        ts: 3_000,
      },
    ]);

    expect(store.openmaEventsFor(sessionId)).toEqual([canonicalPrompt, canonical]);
    expect(store.turnsFor(sessionId)[0]).toMatchObject({
      promptText: "replay this",
      assistantText: "once",
      endedAt: 2_000,
    });
  });

  test("replays canonical work items and session facts into existing GUI slots", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-canonical-facts";
    const turnId = "turn-replay-canonical-facts";
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-replay-canonical-facts",
      agent_id: "pi-acp",
      cwd: "/tmp/project",
    });
    const base = {
      session_id: sessionId,
      turn_id: turnId,
      source: { kind: "harness" as const, harness: "pi-acp", adapter: "acp" },
      occurred_at: "2026-08-05T00:00:01.000Z",
    };
    const event = (
      event_id: string,
      type: "work_item.started" | "work_item.completed" | "command_catalog.updated" | "usage.updated" | "system.notice" | "agent.message_chunk",
      data: Record<string, unknown>,
    ) => createOpenMAEvent({
      ...base,
      event_id,
      type,
      data,
      ...(type.startsWith("work_item.") ? { work_item_id: "work-start" } : {}),
    });
    const sessionStarted = createOpenMAEvent({
      event_id: "session-started-replay",
      type: "session.started",
      session_id: sessionId,
      source: base.source,
      occurred_at: "2026-08-05T00:00:00.000Z",
      data: {
        acp_session_id: "acp-replay-canonical-facts",
        agent_id: "pi-acp",
        cwd: "/tmp/project",
        config_options: initialConfig,
        capabilities: {
          session_fork: true,
          steering: true,
        },
      },
    });

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "openma_event",
        data: JSON.stringify(sessionStarted),
        ts: 500,
      },
      {
        seq: 2,
        type: "user_prompt",
        data: JSON.stringify({ text: "run background work" }),
        ts: 1_000,
      },
      {
        seq: 3,
        type: "openma_event",
        data: JSON.stringify(event("work-start", "work_item.started", {
          kind: "bash",
          title: "Background Bash",
          command: "pnpm test",
        })),
        ts: 2_000,
      },
      {
        seq: 4,
        type: "openma_event",
        data: JSON.stringify(event("commands", "command_catalog.updated", {
          commands: [{ name: "review", description: "Review changes" }],
        })),
        ts: 3_000,
      },
      {
        seq: 5,
        type: "openma_event",
        data: JSON.stringify(event("usage", "usage.updated", { used: 12, size: 100 })),
        ts: 4_000,
      },
      {
        seq: 6,
        type: "openma_event",
        data: JSON.stringify(event("notice", "system.notice", {
          message: "Background task finished",
          tone: "warning",
        })),
        ts: 5_000,
      },
      {
        seq: 7,
        type: "openma_event",
        data: JSON.stringify(event("work-complete", "work_item.completed", {
          kind: "bash",
          result: { exit_code: 0 },
        })),
        ts: 6_000,
      },
    ]);

    expect(store.workItemsFor(sessionId)).toEqual([
      expect.objectContaining({
        id: "work-start",
        kind: "bash",
        status: "completed",
        title: "Background Bash",
        result: { exit_code: 0 },
      }),
    ]);
    expect(store.get(sessionId)).toMatchObject({
      supportsSessionFork: true,
      supportsSteering: true,
      configOptions: initialConfig,
      currentModeId: "code",
      availableCommands: [{ name: "review", description: "Review changes" }],
      usage: { used: 12, size: 100 },
      notice: expect.objectContaining({ message: "Background task finished" }),
    });
  });

  test("replays a canonical turn error into the existing turn error slot", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-canonical-error";
    const turnId = "turn-replay-canonical-error";
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-replay-canonical-error",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "fail this turn" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "openma_event",
        data: JSON.stringify(createOpenMAEvent({
          event_id: "canonical-turn-error",
          type: "session.error",
          session_id: sessionId,
          turn_id: turnId,
          source: { kind: "harness", harness: "claude-acp", adapter: "acp" },
          occurred_at: "2026-08-05T00:00:02.000Z",
          data: { message: "provider rejected the prompt" },
        })),
        ts: 2_000,
      },
    ]);

    expect(store.turnsFor(sessionId)[0]).toMatchObject({
      status: "error",
      errorMessage: "provider rejected the prompt",
      endedAt: 2_000,
    });
  });

  test("lets a persisted turn terminal supersede an earlier provider running level", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-provider-running";
    const turnId = "turn-replay-provider-running";
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-replay-provider-running",
      agent_id: "pi-acp",
      cwd: "/tmp/project",
    });
    const base = {
      session_id: sessionId,
      turn_id: turnId,
      source: { kind: "harness" as const, harness: "pi-acp", adapter: "pi" },
    };

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Run the audit" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "openma_event",
        data: JSON.stringify(createOpenMAEvent({
          ...base,
          event_id: "provider-running-before-terminal",
          type: "session.running",
          occurred_at: "2026-08-05T00:00:01.000Z",
          data: { queue_depth: 1 },
        })),
        ts: 2_000,
      },
      {
        seq: 3,
        type: "openma_event",
        data: JSON.stringify(createOpenMAEvent({
          ...base,
          event_id: "host-turn-terminal",
          type: "turn.completed",
          occurred_at: "2026-08-05T00:00:02.000Z",
          data: { stop_reason: "end_turn" },
        })),
        ts: 3_000,
      },
    ]);

    expect(store.get(sessionId)?.status).toBe("ready");
    expect(store.turnsFor(sessionId)[0]?.status).toBe("complete");
  });

  test("preserves provider queue depth across canonical running and idle levels", () => {
    const store = new SessionStore();
    const sessionId = "sess-pi-provider-queue";
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-pi-provider-queue",
      agent_id: "pi-acp",
      cwd: "/tmp/project",
    });
    const applyLevel = (type: "session.running" | "session.idle", depth: number) => {
      const event = createOpenMAEvent({
        event_id: `${type}-${depth}`,
        session_id: sessionId,
        source: { kind: "harness", harness: "pi-acp", adapter: "pi" },
        occurred_at: "2026-08-05T00:00:00.000Z",
        type,
        data: { queue_depth: depth },
      });
      store.apply({
        type: "session.event",
        session_id: sessionId,
        turn_id: "turn-pi-provider-queue",
        event,
        openma_event: event,
      });
    };

    applyLevel("session.running", 2);
    expect(store.get(sessionId)).toMatchObject({
      status: "running",
      providerQueueDepth: 2,
    });

    applyLevel("session.idle", 0);
    expect(store.get(sessionId)).toMatchObject({
      status: "ready",
      providerQueueDepth: 0,
    });
  });

  test("replays canonical native Agent lifecycle and nested transcript into the Agents view", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-native-agent";
    const turnId = "turn-replay-native-agent";
    const childId = "claude-child-replay";
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-replay-native-agent",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    const base = {
      session_id: sessionId,
      turn_id: turnId,
      source: { kind: "harness" as const, harness: "claude", adapter: "claude" },
    };
    const event = (
      event_id: string,
      type: "work_item.started" | "agent.message_chunk" | "usage.updated" | "work_item.completed",
      data: Record<string, unknown>,
      occurred_at: string,
    ) => createOpenMAEvent({
      ...base,
      event_id,
      type,
      occurred_at,
      work_item_id: childId,
      parent_id: "task-parent-replay",
      data,
    });

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "delegate this" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "openma_event",
        data: JSON.stringify(event(
          "native-start-replay",
          "work_item.started",
          { kind: "agent", title: "Inspect the repository" },
          "2026-08-05T00:00:01.000Z",
        )),
        ts: 2_000,
      },
      {
        seq: 3,
        type: "openma_event",
        data: JSON.stringify(event(
          "native-message-replay",
          "agent.message_chunk",
          { text: "Child found the boundary." },
          "2026-08-05T00:00:02.000Z",
        )),
        ts: 3_000,
      },
      {
        seq: 4,
        type: "openma_event",
        data: JSON.stringify(event(
          "native-usage-replay",
          "usage.updated",
          { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
          "2026-08-05T00:00:03.000Z",
        )),
        ts: 4_000,
      },
      {
        seq: 5,
        type: "openma_event",
        data: JSON.stringify(event(
          "native-complete-replay",
          "work_item.completed",
          { result: "done" },
          "2026-08-05T00:00:04.000Z",
        )),
        ts: 5_000,
      },
    ]);

    const activity = store.subagentsFor(sessionId)[0]!;
    expect(activity).toMatchObject({
      childSessionId: childId,
      task: "Inspect the repository",
      status: "complete",
      native: {
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
        },
      },
    });
    expect(store.turnsFor(activity.viewSessionId)[0]).toMatchObject({
      assistantText: "Child found the boundary.",
    });
  });

  test("collapses a replayed native Agent provisional id into its reidentified terminal child", () => {
    const sessionId = "sess-replay-native-reidentified";
    const turnId = "turn-replay-native-reidentified";
    const parentToolUseId = "toolu-native-agent";
    const provisionalId = `claude:${parentToolUseId}`;
    const childId = "claude-child-final";
    const stale = new SessionStore();
    stale.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-replay-native-reidentified",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    stale.registerTurn("stale-turn", sessionId, "stale native children");
    for (const [toolCallId, description] of [
      ["toolu-stale-a", "Reply CHILD_OK only"],
      ["toolu-stale-b", "Reply with exactly: CHILD_OK"],
    ] as const) {
      stale.apply({
        type: "session.event",
        session_id: sessionId,
        turn_id: "stale-turn",
        event: {
          type: "agent.tool_use",
          id: toolCallId,
          name: "Agent",
          input: {
            subagent_type: "general-purpose",
            description,
            prompt: description,
          },
        },
      });
    }

    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-replay-native-reidentified",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });
    const staleSnapshots = stale.sideWorkspaceSnapshots();
    const staleState = staleSnapshots[0]!.state;
    const restoredActivity = staleState.subagents[0]!;
    restoredActivity.childSessionId = childId;
    restoredActivity.native = {
      ...(restoredActivity.native ?? { provider: "claude" }),
      provider: "claude",
      toolCallId: parentToolUseId,
      childThreadId: childId,
    };
    staleState.subagents = [restoredActivity];
    staleState.sideSessions = staleState.sideSessions.filter(
      (item) => item.row.id === restoredActivity.viewSessionId,
    );
    const canonicalTab = staleState.tabs.find(
      (tab) => tab.payload === restoredActivity.viewSessionId,
    )!;
    staleState.tabs = [
      canonicalTab,
      {
        ...canonicalTab,
        id: "tab-duplicate-native-child",
        label: "Reply with exactly: CHILD_OK",
      },
    ];
    staleState.activeTabId = "tab-duplicate-native-child";
    store.hydrateSideWorkspaces(staleSnapshots);
    expect(store.subagentsFor(sessionId)).toHaveLength(1);
    expect(store.sideTabs()).toHaveLength(2);
    store.setSideActive(null);
    const canonical = (
      eventId: string,
      type: "work_item.started" | "work_item.reidentified" | "work_item.completed",
      workItemId: string,
      data: Record<string, unknown>,
    ) => createOpenMAEvent({
      event_id: eventId,
      type,
      session_id: sessionId,
      turn_id: turnId,
      work_item_id: workItemId,
      parent_id: parentToolUseId,
      source: { kind: "harness", harness: "claude", adapter: "claude" },
      occurred_at: "2026-08-05T00:00:00.000Z",
      data,
    });

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "delegate this" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "openma_event",
        data: JSON.stringify(canonical(
          "native-provisional-start",
          "work_item.started",
          provisionalId,
          { kind: "agent", title: "Reply CHILD_OK only" },
        )),
        ts: 2_000,
      },
      {
        seq: 3,
        type: "openma_event",
        data: JSON.stringify(canonical(
          "native-reidentified",
          "work_item.reidentified",
          childId,
          { previous_work_item_id: provisionalId },
        )),
        ts: 3_000,
      },
      {
        seq: 4,
        type: "openma_event",
        data: JSON.stringify(canonical(
          "native-final-start",
          "work_item.started",
          childId,
          { kind: "agent", title: "Reply CHILD_OK only" },
        )),
        ts: 4_000,
      },
      {
        seq: 5,
        type: "openma_event",
        data: JSON.stringify(canonical(
          "native-final-complete",
          "work_item.completed",
          childId,
          { kind: "agent", result: "CHILD_OK" },
        )),
        ts: 5_000,
      },
    ]);

    const activities = store.subagentsFor(sessionId);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      childSessionId: childId,
      task: "Reply CHILD_OK only",
      status: "complete",
      native: {
        provider: "claude",
        toolCallId: parentToolUseId,
        result: "CHILD_OK",
      },
    });
    expect(store.sideTabs()).toEqual([
      expect.objectContaining({
        type: "subagent",
        payload: activities[0]!.viewSessionId,
      }),
    ]);
    expect(store.sideActiveId()).toBe(activities[0]!.viewSessionId);
  });

  test("replays total-only native Agent progress usage without inventing a token split", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-native-progress";
    const childId = "claude-child-progress";
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-replay-native-progress",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });

    const canonical = (
      eventId: string,
      type: "work_item.started" | "work_item.progress",
      data: Record<string, unknown>,
    ) => createOpenMAEvent({
      event_id: eventId,
      type,
      session_id: sessionId,
      turn_id: "turn-replay-native-progress",
      work_item_id: childId,
      parent_id: "task-parent-progress",
      source: { kind: "harness", harness: "claude", adapter: "claude" },
      occurred_at: "2026-08-05T00:00:00.000Z",
      data,
    });

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "openma_event",
        data: JSON.stringify(canonical(
          "native-progress-start",
          "work_item.started",
          { kind: "agent", title: "Inspect token accounting" },
        )),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "openma_event",
        data: JSON.stringify(canonical(
          "native-progress-usage",
          "work_item.progress",
          {
            output: {
              kind: "subagent_progress",
              usage: { totalTokens: 901, toolUses: 4, durationMs: 1_250 },
            },
          },
        )),
        ts: 2_000,
      },
    ]);

    expect(store.subagentsFor(sessionId)[0]).toMatchObject({
      childSessionId: childId,
      native: {
        progress: {
          usage: { totalTokens: 901, toolUses: 4, durationMs: 1_250 },
        },
      },
    });
    expect(store.subagentsFor(sessionId)[0]?.native?.usage).toBeUndefined();
  });
});

describe("SessionStore performance invariants", () => {
  test("keeps prompt attachments on a live optimistic turn", () => {
    const store = new SessionStore();
    store.registerStarting("sess-attachments", "codex-acp", "Attachments");
    const attachment = {
      id: "attachment-1",
      name: "reference.png",
      path: "/tmp/reference.png",
      uri: "file:///tmp/reference.png",
      kind: "image" as const,
      mimeType: "image/png",
    };
    const registerWithAttachments = store.registerTurn.bind(store) as (
      turnId: string,
      sessionId: string,
      promptText: string,
      delivery: undefined,
      sessionReferences: [],
      attachments: typeof attachment[],
    ) => void;

    registerWithAttachments(
      "turn-attachments",
      "sess-attachments",
      "Use this image",
      undefined,
      [],
      [attachment],
    );

    expect(store.turnsFor("sess-attachments")[0]?.attachments).toEqual([attachment]);
  });

  test("shows Codex skill-context warnings as expiring session notices", async () => {
    vi.useFakeTimers();
    try {
      const store = new SessionStore();
      store.registerStarting("sess-warning", "codex-acp", "Codex");
      store.registerTurn("turn-warning", "sess-warning", "hello");
      const warning =
        "Warning: Skill descriptions were shortened to fit the 2% skills context budget. " +
        "Codex can still see every skill, but some descriptions are shorter.";

      store.apply({
        type: "session.event",
        session_id: "sess-warning",
        turn_id: "turn-warning",
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `${warning}\n\n` },
        },
      });

      expect(store.get("sess-warning")?.notice).toMatchObject({
        message: warning,
        tone: "warning",
      });
      expect(store.turnsFor("sess-warning")[0]?.assistantText).toBe("");

      await vi.advanceTimersByTimeAsync(9_999);
      expect(store.get("sess-warning")?.notice).toBeDefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(store.get("sess-warning")?.notice).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("reuses collection snapshots when an unrelated store slice changes", () => {
    const store = new SessionStore();
    store.registerStarting("sess-1", "codex-acp", "First");
    store.registerTurn("turn-1", "sess-1", "hello");
    const turnsSelector = selectTurnsFor("sess-1");

    const sessionsBefore = store.snapshot(selectSessions);
    const turnsBefore = store.snapshot(turnsSelector);

    store.setSideActive("unrelated-side-session");

    expect(store.snapshot(selectSessions)).toBe(sessionsBefore);
    expect(store.snapshot(turnsSelector)).toBe(turnsBefore);

    store.registerTurn("turn-2", "sess-1", "changed");
    expect(store.snapshot(turnsSelector)).not.toBe(turnsBefore);
  });

  test("coalesces adjacent streaming chunks without losing tool boundaries", () => {
    const store = new SessionStore();
    store.registerStarting("sess-1", "codex-acp", "First");
    store.registerTurn("turn-1", "sess-1", "hello");
    const firstRun = Array.from({ length: 500 }, (_, i) => `a${i};`);
    const secondRun = Array.from({ length: 500 }, (_, i) => `b${i};`);

    for (const text of firstRun) {
      store.apply({
        type: "session.event",
        session_id: "sess-1",
        turn_id: "turn-1",
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
    }
    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Read file",
        status: "completed",
      },
    });
    for (const text of secondRun) {
      store.apply({
        type: "session.event",
        session_id: "sess-1",
        turn_id: "turn-1",
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
    }

    const turn = store.turnsFor("sess-1")[0]!;
    expect(turn.assistantText).toBe(firstRun.join("") + secondRun.join(""));
    expect(turn.events).toHaveLength(3);
  });

  test("publishes trailing final-answer events when a turn completes after its last tool", () => {
    const store = new SessionStore();
    const sessionId = "sess-final-after-tool";
    const turnId = "turn-final-after-tool";
    const selector = selectTurnsFor(sessionId);
    store.registerStarting(sessionId, "codex-acp", "Codex");
    store.registerTurn(turnId, sessionId, "create a document");

    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-render",
        title: "View rendered document",
        status: "completed",
      },
    });
    const eventsPublishedAtTool = store.snapshot(selector)[0]!.events;

    for (const text of ["Created ", "the document."]) {
      store.apply({
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg-final",
          _meta: { codex: { phase: "final_answer" } },
          content: { type: "text", text },
        },
      });
    }
    store.apply({
      type: "session.complete",
      session_id: sessionId,
      turn_id: turnId,
    });

    const completed = store.snapshot(selector)[0]!;
    expect(completed.events).not.toBe(eventsPublishedAtTool);
    expect(reduceTurn(completed.events).timeline.at(-1)).toEqual({
      kind: "assistant_text",
      phase: "final_answer",
      text: "Created the document.",
    });
  });

  test("publishes only the first thought chunk so the Reasoning block can mount", () => {
    const store = new SessionStore();
    store.registerStarting("sess-thought", "pi-acp", "Pi");
    store.registerTurn("turn-thought", "sess-thought", "inspect this");
    const turnsSelector = selectTurnsFor("sess-thought");
    const beforeSnapshot = store.snapshot(turnsSelector);
    const beforeThought = store.getVersion();

    store.apply({
      type: "session.event",
      session_id: "sess-thought",
      turn_id: "turn-thought",
      event: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "First" },
      },
    });
    const afterFirstThought = store.getVersion();
    const afterFirstSnapshot = store.snapshot(turnsSelector);

    store.apply({
      type: "session.event",
      session_id: "sess-thought",
      turn_id: "turn-thought",
      event: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: " second" },
      },
    });
    const afterSecondSnapshot = store.snapshot(turnsSelector);

    expect(afterFirstThought).toBe(beforeThought + 1);
    expect(store.getVersion()).toBe(afterFirstThought);
    expect(afterFirstSnapshot).not.toBe(beforeSnapshot);
    expect(afterSecondSnapshot).toBe(afterFirstSnapshot);
  });

  test("publishes the first assistant chunk so the streaming answer can mount", () => {
    const store = new SessionStore();
    store.registerStarting("sess-answer", "codex-acp", "Codex");
    store.registerTurn("turn-answer", "sess-answer", "answer this");
    const turnsSelector = selectTurnsFor("sess-answer");
    const beforeSnapshot = store.snapshot(turnsSelector);
    const beforeEvents = beforeSnapshot[0]!.events;
    const beforeVersion = store.getVersion();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.apply({
      type: "session.event",
      session_id: "sess-answer",
      turn_id: "turn-answer",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "First visible token" },
      },
    });

    const afterFirstSnapshot = store.snapshot(turnsSelector);
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getVersion()).toBe(beforeVersion + 1);
    expect(afterFirstSnapshot).not.toBe(beforeSnapshot);
    expect(afterFirstSnapshot[0]?.events).not.toBe(beforeEvents);
    expect(reduceTurn(afterFirstSnapshot[0]!.events).timeline).toEqual([
      expect.objectContaining({
        kind: "assistant_text",
        text: "First visible token",
      }),
    ]);
    expect(afterFirstSnapshot[0]?.assistantText).toBe("First visible token");

    unsubscribe();
  });

  test("preserves message identity and Codex phase while compacting stream chunks", () => {
    const store = new SessionStore();
    store.registerStarting("sess-phase", "codex-acp", "Codex");
    store.registerTurn("turn-phase", "sess-phase", "inspect this");

    for (const text of ["Checking ", "files"]) {
      store.apply({
        type: "session.event",
        session_id: "sess-phase",
        turn_id: "turn-phase",
        event: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg-commentary",
          _meta: { codex: { phase: "commentary" } },
          content: { type: "text", text },
        },
      });
    }

    const [event] = store.turnsFor("sess-phase")[0]!.events;
    expect(event?.payload).toMatchObject({
      sessionUpdate: "agent_message_chunk",
      messageId: "msg-commentary",
      phase: "commentary",
      content: { type: "text", text: "Checking files" },
    });
  });

  test("publishes each new Codex thought message as a replaceable tail status", () => {
    const store = new SessionStore();
    store.registerStarting("sess-codex-thought", "codex-acp", "Codex");
    store.registerTurn(
      "turn-codex-thought",
      "sess-codex-thought",
      "inspect this",
    );
    const selector = selectTurnsFor("sess-codex-thought");

    store.apply({
      type: "session.event",
      session_id: "sess-codex-thought",
      turn_id: "turn-codex-thought",
      event: {
        sessionUpdate: "agent_thought_chunk",
        messageId: "rs-one",
        content: { type: "text", text: "Planning one" },
      },
    });
    const firstSnapshot = store.snapshot(selector);

    store.apply({
      type: "session.event",
      session_id: "sess-codex-thought",
      turn_id: "turn-codex-thought",
      event: {
        sessionUpdate: "agent_thought_chunk",
        messageId: "rs-two",
        content: { type: "text", text: "Planning two" },
      },
    });
    const secondSnapshot = store.snapshot(selector);

    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(secondSnapshot[0]?.events).toHaveLength(2);
    expect(secondSnapshot[0]?.activeThoughtMessageId).toBe("rs-two");
    expect(secondSnapshot[0]?.activeThoughtSegmentText).toBe("Planning two");
  });
});

describe("SessionStore task side workspace persistence", () => {
  test("round-trips each task's tabs, active surface, artifacts, and native child view", () => {
    const source = new SessionStore();
    source.apply({
      type: "session.ready",
      session_id: "task-a",
      acp_session_id: "acp-task-a",
      agent_id: "codex-acp",
      cwd: "/repo-a",
    });
    source.registerTurn("turn-a", "task-a", "Build the page");
    source.apply({
      type: "session.event",
      session_id: "task-a",
      turn_id: "turn-a",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: ':codex-file-citation{path="/repo-a/index.html" purpose="output"}',
        },
      },
    });
    source.apply({
      type: "session.complete",
      session_id: "task-a",
      turn_id: "turn-a",
    });
    source.openSideTabForTask(
      "task-a",
      "browser",
      "http://localhost:4173/dashboard",
      "Dashboard",
      "browser-a",
    );
    source.patchSideTabForTask("task-a", "browser-a", {
      faviconUrl: "https://example.test/favicon.ico",
    });
    source.openSideTabForTask("task-a", "file", "/repo-a/src", "src", "files-a");
    source.openSideTabForTask("task-a", "terminal", "pty-dead", "repo-a", "term-a");
    source.patchSideTabForTask("task-a", "term-a", { terminalCwd: "/repo-a" });
    source.setActiveSideTabForTask("task-a", "browser-a");

    source.apply({
      type: "session.event",
      session_id: "task-a",
      turn_id: "turn-a",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "spawn-a",
        toolName: "spawn_agent",
        status: "completed",
        rawInput: { message: "Audit the layout" },
        rawOutput: { agent_id: "child-a", nickname: "Layout audit" },
      },
    });
    source.apply({
      type: "session.event",
      session_id: "task-a",
      turn_id: "turn-a",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "wait-a",
        toolName: "wait_agent",
        status: "completed",
        rawInput: { targets: ["child-a"] },
        rawOutput: { status: { "child-a": { completed: "Looks good." } } },
      },
    });

    const snapshots = source.sideWorkspaceSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      taskId: "task-a",
      state: {
        version: 1,
        activeTabId: expect.any(String),
        activeBrowserTabId: "browser-a",
        artifacts: {
          files: expect.arrayContaining(["/repo-a/index.html"]),
          services: [],
        },
      },
    });

    const restored = new SessionStore();
    restored.apply({
      type: "session.ready",
      session_id: "task-a",
      acp_session_id: "acp-task-a",
      agent_id: "codex-acp",
      cwd: "/repo-a",
    });
    restored.hydrateSideWorkspaces(snapshots);
    restored.setActive("task-a");

    expect(restored.sideTabs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser-a",
          payload: "http://localhost:4173/dashboard",
          faviconUrl: "https://example.test/favicon.ico",
        }),
        expect.objectContaining({ id: "files-a", payload: "/repo-a/src" }),
        expect.objectContaining({
          id: "term-a",
          type: "terminal",
          payload: "",
          terminalCwd: "/repo-a",
          needsRestore: true,
        }),
        expect.objectContaining({ type: "subagent", label: "Layout audit" }),
      ]),
    );
    expect(restored.activeSideTabId()).toBe(snapshots[0]!.state.activeTabId);
    expect(restored.browserWindows()[0]?.activeTabId).toBe("browser-a");
    expect(restored.artifactsFor("task-a")).toMatchObject({
      files: expect.arrayContaining(["/repo-a/index.html"]),
      services: [],
    });

    const child = restored.subagentsFor("task-a")[0]!;
    expect(child).toMatchObject({ childSessionId: "child-a", status: "complete" });
    expect(restored.turnsFor(child.viewSessionId)).toEqual([
      expect.objectContaining({
        promptText: "Audit the layout",
        assistantText: "Looks good.",
        status: "complete",
      }),
    ]);
  });
});

describe("SessionStore config options", () => {
  test("stores initial ACP config options from session.ready", () => {
    const store = new SessionStore();

    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });

    expect(store.get("sess-1")?.configOptions).toEqual(initialConfig);
    expect(store.get("sess-1")?.currentModeId).toBe("code");
  });

  test("drops malformed session.ready options with the canonical validator", () => {
    const store = new SessionStore();

    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: [
        {
          id: "telemetry",
          name: "Telemetry",
          type: "boolean",
          currentValue: false,
        },
        {
          id: "broken-model",
          name: "Broken model",
          type: "select",
          currentValue: "opus",
          options: [{ value: "opus" }],
        },
      ],
    });

    expect(store.get("sess-1")?.configOptions).toEqual([
      {
        id: "telemetry",
        name: "Telemetry",
        type: "boolean",
        currentValue: false,
      },
    ]);
  });

  test("replaces config options from config_option_update", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });

    const updated: AcpSessionConfigOption[] = [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "opus",
        options: [
          { value: "sonnet", name: "Claude Sonnet" },
          { value: "opus", name: "Claude Opus" },
        ],
      },
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "review",
        options: [
          { value: "code", name: "Code" },
          { value: "review", name: "Review" },
        ],
      },
    ];

    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: updated,
      },
    });

    expect(store.get("sess-1")?.configOptions).toEqual(updated);
    expect(store.get("sess-1")?.currentModeId).toBe("review");
  });

  test("patches existing rows with persisted creation time", () => {
    const store = new SessionStore();
    store.registerStarting("sess-1", "claude-acp", "Draft label");

    store.seedPersisted([
      {
        id: "sess-1",
        agent_id: "claude-acp",
        cwd: "/tmp/project",
        acp_session_id: "acp-1",
        title: "Persisted label",
        last_used_at: 456,
        created_at: 123,
      },
    ]);

    expect(store.get("sess-1")?.createdAt).toBe(123);
  });

  test("stores session-scoped config option updates without a turn", () => {
    const store = new SessionStore();
    const sessionId = "sess-config-option-update";
    store.registerStarting(sessionId, "codex-acp", "Config test");

    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: "",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "gpt-5",
            options: [{ value: "gpt-5", name: "GPT-5" }],
          },
        ],
      },
    });

    expect(store.get(sessionId)?.configOptions?.[0]?.currentValue).toBe("gpt-5");
  });
});

describe("SessionStore ACP session metadata", () => {
  test("retains initialize identity, capabilities, and workspace evidence on the session row", () => {
    const store = new SessionStore();
    const agentCapabilities = {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      sessionCapabilities: { close: {}, resume: {} },
    };

    store.apply({
      type: "session.ready",
      session_id: "sess-runtime-evidence",
      acp_session_id: "acp-runtime-evidence",
      agent_id: "kimi-code-acp",
      cwd: "/work/primary",
      additional_directories: ["/work/docs", "/work/packages"],
      protocol_version: 1,
      agent_info: { name: "Kimi Code CLI", version: "0.33.0" },
      agent_capabilities: agentCapabilities,
      initialize_meta: { kimi: { channel: "acp" } },
      session_setup_meta: { kimi: { startupInfo: "ready" } },
      supports_session_close: true,
      supports_session_resume: true,
      supports_additional_directories: true,
    });

    expect(store.get("sess-runtime-evidence")).toMatchObject({
      cwd: "/work/primary",
      additionalDirectories: ["/work/docs", "/work/packages"],
      protocolVersion: 1,
      agentInfo: { name: "Kimi Code CLI", version: "0.33.0" },
      agentCapabilities,
      initializeMeta: { kimi: { channel: "acp" } },
      sessionSetupMeta: { kimi: { startupInfo: "ready" } },
      supportsSessionClose: true,
      supportsSessionResume: true,
      supportsAdditionalDirectories: true,
    });
  });

  test("adapts usage updates without creating a transcript turn", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-usage",
      acp_session_id: "acp-usage",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });

    store.apply({
      type: "session.event",
      session_id: "sess-usage",
      turn_id: "turn-does-not-exist",
      event: {
        sessionUpdate: "usage_update",
        used: 206_720,
        size: 258_400,
        cost: { amount: 0.42, currency: "USD" },
      },
    });

    expect(store.get("sess-usage")?.usage).toEqual({
      used: 206_720,
      size: 258_400,
      cost: { amount: 0.42, currency: "USD" },
    });
    expect(store.turnsFor("sess-usage")).toEqual([]);
  });

  test("preserves the last valid usage when a malformed update arrives", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-usage",
      acp_session_id: "acp-usage",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.apply({
      type: "session.event",
      session_id: "sess-usage",
      turn_id: "turn-1",
      event: { sessionUpdate: "usage_update", used: 10, size: 100 },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-usage",
      turn_id: "turn-1",
      event: { sessionUpdate: "usage_update", used: -1, size: 0 },
    });

    expect(store.get("sess-usage")?.usage).toEqual({ used: 10, size: 100 });
  });

  test("merges session info while keeping the local turn lifecycle authoritative", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-info",
      acp_session_id: "acp-info",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.apply({
      type: "session.event",
      session_id: "sess-info",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "session_info_update",
        title: "Agent supplied title",
        updatedAt: "2026-07-18T10:00:00.000Z",
        _meta: {
          codex: {
            threadStatus: { type: "active" },
            stableValue: true,
          },
        },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-info",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "session_info_update",
        _meta: { codex: { threadStatus: { type: "idle" } } },
      },
    });

    expect(store.get("sess-info")).toMatchObject({
      label: "Agent supplied title",
      status: "ready",
      sessionUpdatedAt: "2026-07-18T10:00:00.000Z",
      agentThreadStatus: "idle",
      sessionInfoMeta: {
        codex: {
          threadStatus: { type: "idle" },
          stableValue: true,
        },
      },
    });
    expect(store.turnsFor("sess-info")).toEqual([]);
  });

  test("stores Codex goal updates as session state and clears them", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-goal",
      acp_session_id: "acp-goal",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });

    store.apply({
      type: "session.event",
      session_id: "sess-goal",
      turn_id: "",
      event: {
        sessionUpdate: "session_info_update",
        _meta: {
          codex: {
            goal: {
              objective: "Ship goal progress UI",
              status: "active",
              tokenBudget: 40_000,
            },
          },
        },
      },
    });

    expect(store.get("sess-goal")?.goal).toEqual({
      objective: "Ship goal progress UI",
      status: "active",
      tokenBudget: 40_000,
    });

    store.apply({
      type: "session.event",
      session_id: "sess-goal",
      turn_id: "",
      event: {
        sessionUpdate: "session_info_update",
        _meta: { codex: { goal: null } },
      },
    });

    expect(store.get("sess-goal")?.goal).toBeUndefined();
  });

  test.each(["complete", "completed"])(
    "removes a goal from session state when the agent reports it %s",
    (terminalStatus) => {
      const store = new SessionStore();
      store.apply({
        type: "session.ready",
        session_id: "sess-completed-goal",
        acp_session_id: "acp-completed-goal",
        agent_id: "codex-acp",
        cwd: "/tmp/project",
      });

      store.apply({
        type: "session.event",
        session_id: "sess-completed-goal",
        turn_id: "",
        event: {
          sessionUpdate: "session_info_update",
          _meta: {
            codex: {
              goal: {
                objective: "Finish the Goal lifecycle",
                status: "active",
              },
            },
          },
        },
      });
      expect(store.get("sess-completed-goal")?.goal?.status).toBe("active");

      store.apply({
        type: "session.event",
        session_id: "sess-completed-goal",
        turn_id: "",
        event: {
          sessionUpdate: "session_info_update",
          _meta: {
            codex: {
              goal: {
                objective: "Finish the Goal lifecycle",
                status: terminalStatus,
                timeUsedSeconds: 72,
              },
            },
          },
        },
      });

      expect(store.get("sess-completed-goal")?.goal).toBeUndefined();
    },
  );

  test("does not infer Goal semantics for an unadapted harness", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-generic-goal",
      acp_session_id: "acp-generic-goal",
      agent_id: "other-acp",
      cwd: "/tmp/project",
    });

    store.apply({
      type: "session.event",
      session_id: "sess-generic-goal",
      turn_id: "",
      event: {
        sessionUpdate: "session_info_update",
        goal: {
          objective: "Keep the contract portable",
          status: "paused",
        },
      },
    });

    expect(store.get("sess-generic-goal")?.goal).toBeUndefined();
  });

  test("consumes normalized Goal updates without knowing the harness event shape", () => {
    const store = new SessionStore({
      readSessionGoalUpdate: ({ agentId, meta }) => {
        if (agentId !== "example-harness") return undefined;
        const progress = meta?.["example.com/progress"] as
          | { objectiveText?: unknown; lifecycleState?: unknown }
          | undefined;
        if (
          typeof progress?.objectiveText !== "string" ||
          typeof progress.lifecycleState !== "string"
        ) {
          return undefined;
        }
        return {
          objective: progress.objectiveText,
          status: progress.lifecycleState,
        };
      },
    });
    store.apply({
      type: "session.ready",
      session_id: "sess-namespaced-goal",
      acp_session_id: "acp-namespaced-goal",
      agent_id: "example-harness",
      cwd: "/tmp/project",
    });

    store.apply({
      type: "session.event",
      session_id: "sess-namespaced-goal",
      turn_id: "",
      event: {
        sessionUpdate: "session_info_update",
        _meta: {
          "example.com/progress": {
            objectiveText: "Keep Goal harness-neutral",
            lifecycleState: "active",
          },
        },
      },
    });

    expect(store.get("sess-namespaced-goal")?.goal).toEqual({
      objective: "Keep Goal harness-neutral",
      status: "active",
    });

    store.apply({
      type: "session.event",
      session_id: "sess-namespaced-goal",
      turn_id: "",
      event: {
        sessionUpdate: "session_info_update",
        _meta: {
          "example.com/progress": {
            objectiveText: "Keep Goal harness-neutral",
            lifecycleState: "completed",
          },
        },
      },
    });

    expect(store.get("sess-namespaced-goal")?.goal).toBeUndefined();
  });
});

describe("SessionStore project drafts", () => {
  test("binds a project cwd when the draft is created", () => {
    const store = new SessionStore();

    const id = store.newDraft("/work/project-a");

    expect(store.get(id)).toMatchObject({
      status: "draft",
      chosenCwd: "/work/project-a",
      projectScope: "project",
    });
    expect(store.active()?.id).toBe(id);
  });

  test("marks a global draft as explicitly outside projects", () => {
    const store = new SessionStore();

    const id = store.newDraft();

    expect(store.get(id)).toMatchObject({
      status: "draft",
      projectScope: "none",
    });
  });

  test("binds a named project and preserves secondary workspace roots", () => {
    const store = new SessionStore();

    const id = store.newDraft({
      projectId: "proj-workspace",
      sourceFolders: ["/work/app", "/work/docs", "/work/backend"],
    });

    expect(store.get(id)).toMatchObject({
      chosenCwd: "/work/app",
      projectId: "proj-workspace",
      additionalDirectories: ["/work/docs", "/work/backend"],
      projectScope: "project",
    });
  });

  test("does not restore untitled pre-prompt shells as ghost chats", () => {
    const store = new SessionStore();

    store.seedPersisted([
      {
        id: "legacy-empty",
        agent_id: "codex-acp",
        cwd: "/work/project-a",
        acp_session_id: "acp-empty",
        title: "",
        last_used_at: 1,
        created_at: 1,
      },
    ]);

    expect(store.get("legacy-empty")).toBeUndefined();
  });
});

describe("SessionStore event reducers", () => {
  test("registers explicit Codex output citations when the turn completes", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-codex-output",
      acp_session_id: "acp-codex-output",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.registerTurn("turn-codex-output", "sess-codex-output", "make a deck");

    store.apply({
      type: "session.event",
      session_id: "sess-codex-output",
      turn_id: "turn-codex-output",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: ':codex-file-citation{path="/tmp/project/deck.pptx"}',
        },
      },
    });

    expect(store.artifactsFor("sess-codex-output").files).toEqual([]);

    store.apply({
      type: "session.complete",
      session_id: "sess-codex-output",
      turn_id: "turn-codex-output",
    });

    expect(store.artifactsFor("sess-codex-output")).toMatchObject({
      files: ["/tmp/project/deck.pptx"],
      sources: [],
    });
  });

  test("normalizes Codex opened pages and Claude Code WebFetch as web sources", () => {
    const store = new SessionStore();
    for (const [sessionId, agentId] of [
      ["sess-codex-source", "codex-acp"],
      ["sess-cc-source", "claude-acp"],
    ] as const) {
      store.apply({
        type: "session.ready",
        session_id: sessionId,
        acp_session_id: `acp-${sessionId}`,
        agent_id: agentId,
        cwd: "/tmp/project",
      });
      store.registerTurn(`turn-${sessionId}`, sessionId, "read the reference");
    }

    store.apply({
      type: "session.event",
      session_id: "sess-codex-source",
      turn_id: "turn-sess-codex-source",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "codex-open",
        title: "Open page: https://example.com/codex",
        kind: "search",
        status: "completed",
        rawInput: {
          action: {
            type: "openPage",
            url: "https://example.com/codex",
          },
        },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-cc-source",
      turn_id: "turn-sess-cc-source",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "cc-fetch",
        title: "Fetch https://example.com/claude",
        toolName: "WebFetch",
        kind: "fetch",
        status: "pending",
        rawInput: { url: "https://example.com/claude" },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-cc-source",
      turn_id: "turn-sess-cc-source",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "cc-fetch",
        status: "completed",
        _meta: { claudeCode: { toolName: "WebFetch" } },
        rawOutput: [{ type: "web_fetch_result", url: "https://example.com/claude" }],
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-cc-source",
      turn_id: "turn-sess-cc-source",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "cc-write",
        title: "Write deliverable.pdf",
        kind: "edit",
        status: "pending",
        rawInput: { file_path: "/tmp/project/deliverable.pdf" },
        _meta: { claudeCode: { toolName: "Write" } },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-cc-source",
      turn_id: "turn-sess-cc-source",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "cc-write",
        status: "completed",
        _meta: { claudeCode: { toolName: "Write" } },
      },
    });

    expect(store.artifactsFor("sess-codex-source").sources).toEqual([
      { kind: "web", uri: "https://example.com/codex" },
    ]);
    expect(store.artifactsFor("sess-cc-source").sources).toEqual([
      { kind: "web", uri: "https://example.com/claude" },
    ]);
    expect(store.artifactsFor("sess-cc-source").files).toEqual([
      "/tmp/project/deliverable.pdf",
    ]);
  });

  test("accepts wrapped ACP chunk events on the streaming accumulators", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });
    store.registerTurn("turn-1", "sess-1", "hello");

    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionId: "acp-1",
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Thinking" },
        },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionId: "acp-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "PONG" },
        },
      },
    });

    const turn = store.turnsFor("sess-1")[0];
    expect(turn?.thoughtText).toBe("Thinking");
    expect(turn?.assistantText).toBe("PONG");
  });

  test("accepts bare OpenMA chunk events on the streaming accumulators", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });
    store.registerTurn("turn-1", "sess-1", "hello");

    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: { type: "agent.thinking_chunk", delta: "Checking" },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: { type: "agent.message_chunk", delta: "Done" },
    });

    const turn = store.turnsFor("sess-1")[0];
    expect(turn?.thoughtText).toBe("Checking");
    expect(turn?.assistantText).toBe("Done");
  });

});

describe("SessionStore slash commands", () => {
  test("stores ACP availableCommands updates for the composer slash picker", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });

    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "",
      event: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "web",
            description: "Search the web for information",
            input: { hint: "query to search for" },
          },
          {
            name: "test",
            description: "Run tests for the current project",
          },
        ],
      },
    });

    expect(store.get("sess-1")?.availableCommands).toEqual([
      {
        name: "web",
        description: "Search the web for information",
        input: { hint: "query to search for" },
      },
      {
        name: "test",
        description: "Run tests for the current project",
      },
    ]);
  });

  test("accepts snake_case available command updates", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });

    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "",
      event: {
        sessionUpdate: "available_commands_update",
        available_commands: [
          { name: "review", description: "Review the current workspace" },
          { name: "render", input: { hint: "scene id" } },
        ],
      },
    });

    expect(store.get("sess-1")?.availableCommands).toEqual([
      { name: "review", description: "Review the current workspace" },
      { name: "render", input: { hint: "scene id" } },
    ]);
  });
});

describe("SessionStore prompt queue state", () => {
  test("keeps the active turn running while Stop is only requested", () => {
    const store = new SessionStore();
    const sessionId = "sess-cancel-requested";
    store.registerStarting(sessionId, "codex-acp", "Stop request test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-cancel-requested",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-active", sessionId, "keep running until acknowledged");

    store.apply({
      type: "session.cancel_requested",
      session_id: sessionId,
      turn_id: "turn-active",
    });

    expect(store.get(sessionId)?.activeTurnId).toBe("turn-active");
    expect(store.get(sessionId)?.status).toBe("running");
    expect(store.turnsFor(sessionId)[0]?.status).toBe("running");
  });

  test("settles an acknowledged Stop as cancelled and clears the active turn", () => {
    const store = new SessionStore();
    const sessionId = "sess-cancelled";
    store.registerStarting(sessionId, "claude-acp", "Stop acknowledgement test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-cancelled",
      agent_id: "claude-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-cancelled", sessionId, "stop this turn");

    store.apply({
      type: "session.cancelled",
      session_id: sessionId,
      turn_id: "turn-cancelled",
    });

    expect(store.turnsFor(sessionId)[0]?.status).toBe("cancelled");
    expect(store.turnsFor(sessionId)[0]?.endedAt).toEqual(expect.any(Number));
    expect(store.get(sessionId)?.activeTurnId).toBeUndefined();
    expect(store.get(sessionId)?.status).toBe("ready");
  });

  test("promotes the next FIFO turn after the active turn is cancelled", () => {
    const store = new SessionStore();
    const sessionId = "sess-cancel-fifo";
    store.registerStarting(sessionId, "codex-acp", "Stop FIFO test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-cancel-fifo",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-cancelled", sessionId, "first");
    store.registerTurn("turn-next", sessionId, "second");

    store.apply({
      type: "session.cancelled",
      session_id: sessionId,
      turn_id: "turn-cancelled",
    });

    expect(store.get(sessionId)?.activeTurnId).toBe("turn-next");
    expect(store.get(sessionId)?.queuedTurnIds).toBeUndefined();
    expect(store.turnsFor(sessionId).map((turn) => turn.status)).toEqual([
      "cancelled",
      "running",
    ]);
  });

  test("deduplicates broker asks and clears them when the active turn terminates", () => {
    const store = new SessionStore();
    const sessionId = "sess-broker-lifecycle";
    store.registerStarting(sessionId, "codex-acp", "Approval test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-broker-lifecycle",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-active", sessionId, "run it");
    const brokerAsk = {
      kind: "permission" as const,
      ask: {
        requestId: "permission-1",
        sessionId,
        toolCall: { title: "Run command" },
        presentation: { title: "Run command" },
        options: [
          {
            optionId: "cancel",
            name: "Cancel",
            kind: "reject_once" as const,
          },
        ],
      },
    };

    store.enqueueAsk(sessionId, brokerAsk);
    store.enqueueAsk(sessionId, brokerAsk);
    expect(store.get(sessionId)?.pendingAsks).toEqual([brokerAsk]);

    store.apply({
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-active",
    });
    expect(store.get(sessionId)?.pendingAsks).toBeUndefined();
  });

  test("retains an approval that arrives before its session row is restored", () => {
    const store = new SessionStore();
    const sessionId = "sess-late-restore";
    const brokerAsk = {
      kind: "permission" as const,
      ask: {
        requestId: "permission-before-ready",
        sessionId,
        toolCall: { title: "Run command" },
        presentation: { title: "Run command" },
        options: [
          {
            optionId: "allow",
            name: "Allow",
            kind: "allow_once" as const,
          },
        ],
      },
    };

    store.enqueueAsk(sessionId, brokerAsk);
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-late-restore",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    expect(store.get(sessionId)?.pendingAsks).toEqual([brokerAsk]);
  });

  test("keeps the active turn running and marks later turns queued", () => {
    const store = new SessionStore();
    const sessionId = "sess-queue-state";
    store.registerStarting(sessionId, "codex-acp", "Queue test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-queue-state",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    store.registerTurn("turn-active", sessionId, "first");
    store.registerTurn("turn-queued", sessionId, "second");

    expect(store.get(sessionId)?.activeTurnId).toBe("turn-active");
    expect(store.get(sessionId)?.queuedTurnIds).toEqual(["turn-queued"]);
    expect(store.turnsFor(sessionId).map((turn) => turn.status)).toEqual([
      "running",
      "queued",
    ]);

    store.apply({
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-active",
    });

    expect(store.get(sessionId)?.activeTurnId).toBe("turn-queued");
    expect(store.get(sessionId)?.status).toBe("running");
    expect(store.turnsFor(sessionId).map((turn) => turn.status)).toEqual([
      "complete",
      "running",
    ]);

    store.apply({
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-queued",
    });

    expect(store.get(sessionId)?.activeTurnId).toBeUndefined();
    expect(store.get(sessionId)?.status).toBe("ready");
  });

  test("queues llm-boundary steer turns behind the active turn", () => {
    const store = new SessionStore();
    const sessionId = "sess-queue-delivery";
    store.registerStarting(sessionId, "codex-acp", "Queue delivery test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-queue-delivery",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    store.registerTurn("turn-active-delivery", sessionId, "first", {
      intent: "submit",
      requestedDelivery: "turn_end",
      effectiveDelivery: "turn_end",
      degraded: false,
    });
    store.registerTurn("turn-steer", sessionId, "steer me", {
      intent: "steer",
      requestedDelivery: "llm_boundary",
      effectiveDelivery: "turn_end",
      degraded: true,
    });

    const steer = store
      .turnsFor(sessionId)
      .find((turn) => turn.id === "turn-steer");

    expect(steer?.status).toBe("queued");
    expect(steer?.promptIntent).toBe("steer");
    expect(steer?.requestedDelivery).toBe("llm_boundary");
    expect(steer?.effectiveDelivery).toBe("turn_end");
    expect(steer?.deliveryDegraded).toBe(true);
    expect(store.get(sessionId)?.activeTurnId).toBe("turn-active-delivery");
    expect(store.get(sessionId)?.queuedTurnIds).toEqual(["turn-steer"]);
  });

  test("applies main-process queue snapshots", () => {
    const store = new SessionStore();
    const sessionId = "sess-main-queue";
    store.registerStarting(sessionId, "codex-acp", "Queue snapshot test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-main-queue",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    store.apply({
      type: "session.queue_update",
      session_id: sessionId,
      mode: "single",
      active_turn_id: "turn-active",
      queued: [{ turn_id: "turn-next", text: "next", created_at: 123 }],
    });

    expect(store.get(sessionId)?.activeTurnId).toBe("turn-active");
    expect(store.get(sessionId)?.queuedPrompts).toEqual([
      { turn_id: "turn-next", text: "next", created_at: 123 },
    ]);
  });

  test("uses queue snapshots to edit, reorder, and remove optimistic queued turns", () => {
    const store = new SessionStore();
    const sessionId = "sess-managed-queue";
    store.registerStarting(sessionId, "codex-acp", "Managed queue test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-managed-queue",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-active", sessionId, "first");
    store.registerTurn("turn-two", sessionId, "old two");
    store.registerTurn("turn-three", sessionId, "old three");

    store.apply({
      type: "session.queue_update",
      session_id: sessionId,
      mode: "single",
      active_turn_id: "turn-active",
      queued: [
        { turn_id: "turn-three", text: "edited three", created_at: 3 },
        { turn_id: "turn-two", text: "edited two", created_at: 2 },
      ],
    });

    expect(store.get(sessionId)?.queuedTurnIds).toEqual([
      "turn-three",
      "turn-two",
    ]);
    expect(
      store.turnsFor(sessionId).map((turn) => [turn.id, turn.promptText]),
    ).toEqual([
      ["turn-active", "first"],
      ["turn-two", "edited two"],
      ["turn-three", "edited three"],
    ]);

    store.apply({
      type: "session.queue_update",
      session_id: sessionId,
      mode: "single",
      active_turn_id: "turn-active",
      queued: [
        { turn_id: "turn-three", text: "edited three", created_at: 3 },
      ],
    });

    expect(store.get(sessionId)?.queuedTurnIds).toEqual(["turn-three"]);
    expect(store.turnsFor(sessionId).map((turn) => turn.id)).toEqual([
      "turn-active",
      "turn-three",
    ]);
  });

  test("keeps a steered queue turn visible as running while it is removed from FIFO", () => {
    const store = new SessionStore();
    const sessionId = "sess-steering-queue";
    store.registerStarting(sessionId, "codex-acp", "Steering queue test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-steering-queue",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-active", sessionId, "first");
    store.registerTurn("turn-steer", sessionId, "steer me");
    store.registerTurn("turn-three", sessionId, "third");

    store.apply({
      type: "session.queue_update",
      session_id: sessionId,
      mode: "single",
      active_turn_id: "turn-active",
      queued: [{ turn_id: "turn-three", text: "third", created_at: 3 }],
      steering_turn_ids: ["turn-steer"],
    });

    expect(store.get(sessionId)?.queuedTurnIds).toEqual(["turn-three"]);
    expect(store.turnsFor(sessionId).map((turn) => [turn.id, turn.status])).toEqual([
      ["turn-active", "running"],
      ["turn-steer", "running"],
      ["turn-three", "queued"],
    ]);
  });

  test("settles an injected steering input without completing the active turn", () => {
    const store = new SessionStore();
    const sessionId = "steering-input-session";
    store.registerStarting(sessionId, "claude-acp", "Steering input");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-steering-input",
      agent_id: "claude-acp",
      cwd: "/repo",
      supports_steering: true,
    });
    store.registerTurn("turn-active", sessionId, "first");
    store.apply({
      type: "session.queue_update",
      session_id: sessionId,
      mode: "single",
      active_turn_id: "turn-active",
      queued: [],
    });
    store.registerTurn("turn-steer", sessionId, "change direction", {
      intent: "steer",
      requestedDelivery: "llm_boundary",
      effectiveDelivery: "llm_boundary",
      degraded: false,
    });

    store.apply({
      type: "session.steering",
      session_id: sessionId,
      turn_id: "turn-steer",
      active_turn_id: "turn-active",
      text: "change direction",
      requested_delivery: "llm_boundary",
      effective_delivery: "llm_boundary",
      outcome: "injected",
    });

    expect(store.turnsFor(sessionId).map((turn) => [turn.id, turn.status])).toEqual([
      ["turn-active", "running"],
      ["turn-steer", "complete"],
    ]);
    expect(store.get(sessionId)).toMatchObject({
      status: "running",
      activeTurnId: "turn-active",
    });
  });

  test("keeps a steering input running when the adapter started a new turn", () => {
    const store = new SessionStore();
    const sessionId = "steering-new-turn-session";
    store.registerStarting(sessionId, "codex-acp", "Steering new turn");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-steering-new-turn",
      agent_id: "codex-acp",
      cwd: "/repo",
      supports_steering: true,
    });
    store.registerTurn("turn-steer", sessionId, "continue after the race", {
      intent: "steer",
      requestedDelivery: "llm_boundary",
      effectiveDelivery: "llm_boundary",
      degraded: false,
    });

    store.apply({
      type: "session.steering",
      session_id: sessionId,
      turn_id: "turn-steer",
      active_turn_id: "turn-previous",
      text: "continue after the race",
      requested_delivery: "llm_boundary",
      effective_delivery: "llm_boundary",
      outcome: "startedNewTurn",
    });

    expect(store.turnsFor(sessionId)[0]?.status).toBe("running");
    expect(store.get(sessionId)).toMatchObject({
      status: "running",
      activeTurnId: "turn-steer",
    });
  });
});

describe("SessionStore side chats and native subagents", () => {
  test("stores steering capability from session.ready events", () => {
    const store = new SessionStore();

    store.apply({
      type: "session.ready",
      session_id: "steering-session",
      acp_session_id: "steering-acp",
      agent_id: "claude-acp",
      cwd: "/repo",
      supports_steering: true,
    });

    expect(store.get("steering-session")?.supportsSteering).toBe(true);
  });

  test("stores fork capability from session.ready events", () => {
    const store = new SessionStore();

    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-acp",
      agent_id: "codex-acp",
      cwd: "/repo",
      supports_session_fork: true,
      config_options: [{
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "deepseek-v4-flash",
        options: [{
          value: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
        }],
      }],
    });

    expect(store.get("parent-session")?.supportsSessionFork).toBe(true);
  });

  test("opens a subordinate side chat with fork inheritance", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-acp",
      agent_id: "codex-acp",
      cwd: "/repo",
      supports_session_fork: true,
      config_options: [{
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "deepseek-v4-flash",
        options: [{
          value: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
        }],
      }],
    });

    const childId = store.newSideDraft({
      parentSessionId: "parent-session",
      parentAcpSessionId: "parent-acp",
      inheritance: "fork",
      agentId: "codex-acp",
      cwd: "/repo",
    });
    store.openSideTab("chat", childId, "Side chat");

    expect(store.get(childId)).toMatchObject({
      kind: "side",
      sideKind: "chat",
      agent_id: "codex-acp",
      cwd: "/repo",
      sideParent: {
        parentSessionId: "parent-session",
        parentAcpSessionId: "parent-acp",
        inheritance: "fork",
      },
      configOptions: [{
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "deepseek-v4-flash",
        options: [{
          value: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
        }],
      }],
    });
    expect(store.activeSideTab()?.type).toBe("chat");
    expect(store.sideActiveId()).toBe(childId);
  });

  test("creates an independent main draft that lazily forks the parent context", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-acp",
      agent_id: "codex-acp",
      cwd: "/repo",
      supports_session_fork: true,
    });

    const forkId = store.newMainForkDraft("parent-session");

    expect(forkId).toEqual(expect.stringMatching(/^fork-/));
    expect(store.get(forkId!)).toMatchObject({
      kind: "main",
      status: "draft",
      agent_id: "codex-acp",
      cwd: "/repo",
      forkParent: {
        parentSessionId: "parent-session",
        parentAcpSessionId: "parent-acp",
        inheritance: "fork",
      },
    });
    expect(store.activeId()).toBe(forkId);
    expect(store.newMainForkDraft("missing-session")).toBeNull();
  });

  test("promotes a side chat into an independent fork", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-acp",
      agent_id: "codex-acp",
      cwd: "/repo",
      supports_session_fork: true,
    });
    const childId = store.newSideDraft({
      parentSessionId: "parent-session",
      parentAcpSessionId: "parent-acp",
      inheritance: "fork",
      agentId: "codex-acp",
      cwd: "/repo",
    });
    store.openSideTab("chat", childId, "Side chat");

    expect(store.promoteSideToMain(childId)).toBe(childId);

    expect(store.get(childId)).toMatchObject({
      kind: "main",
      sideKind: undefined,
      sideParent: undefined,
    });
    expect(store.activeId()).toBe(childId);
    expect(store.sideActiveId()).toBeNull();
    expect(store.activeSideTab()).toBeNull();
  });

  test("keeps an independent multi-tab browser window for each task", () => {
    const store = new SessionStore();
    for (const sessionId of ["task-a", "task-b"]) {
      store.apply({
        type: "session.ready",
        session_id: sessionId,
        acp_session_id: `acp-${sessionId}`,
        agent_id: "codex-acp",
        cwd: "/repo",
      });
    }

    store.openSideTabForTask(
      "task-a",
      "browser",
      "https://a.example/one",
      "A one",
      "browser-a-1",
    );
    store.openSideTabForTask(
      "task-a",
      "browser",
      "https://a.example/two",
      "A two",
      "browser-a-2",
    );
    store.openSideTabForTask(
      "task-b",
      "browser",
      "https://b.example/one",
      "B one",
      "browser-b-1",
    );

    expect(store.browserWindows()).toEqual([
      {
        taskId: "task-a",
        activeTabId: "browser-a-2",
        tabs: [
          expect.objectContaining({ id: "browser-a-1", payload: "https://a.example/one" }),
          expect.objectContaining({ id: "browser-a-2", payload: "https://a.example/two" }),
        ],
      },
      {
        taskId: "task-b",
        activeTabId: "browser-b-1",
        tabs: [
          expect.objectContaining({ id: "browser-b-1", payload: "https://b.example/one" }),
        ],
      },
    ]);

    store.setActiveSideTabForTask("task-a", "browser-a-1");
    expect(store.browserWindows()[0]?.activeTabId).toBe("browser-a-1");
    expect(store.browserWindows()[1]?.activeTabId).toBe("browser-b-1");
  });

  test("task browser opens are idempotent for a tool-provided tab id", () => {
    const store = new SessionStore();
    store.openSideTabForTask(
      "task-a",
      "browser",
      "about:blank",
      "New tab",
      "browser-tool-tab",
    );
    store.openSideTabForTask(
      "task-a",
      "browser",
      "https://example.com",
      "Example",
      "browser-tool-tab",
    );

    const window = store.browserWindows()[0];
    expect(window?.tabs).toHaveLength(1);
    expect(window?.tabs[0]).toMatchObject({
      id: "browser-tool-tab",
      payload: "https://example.com",
      label: "Example",
    });
  });

  test("tracks Codex native multi-agent tool calls as parent subagent activity", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-codex-thread",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-parent", "parent-session", "Ask a native Codex subagent");

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "call-spawn",
        toolName: "spawn_agent",
        status: "completed",
        rawInput: {
          agent_type: "default",
          fork_context: false,
          message: "Review the auth boundary",
        },
        rawOutput: JSON.stringify({
          agent_id: "codex-child-thread",
          nickname: "Cicero",
        }),
      },
    });

    expect(store.subagentsFor("parent-session")).toEqual([
      expect.objectContaining({
        childSessionId: "codex-child-thread",
        parentSessionId: "parent-session",
        parentAcpSessionId: "parent-codex-thread",
        inheritance: "fresh",
        task: "Review the auth boundary",
        status: "running",
        native: expect.objectContaining({
          provider: "codex",
          toolCallId: "call-spawn",
          childThreadId: "codex-child-thread",
          nickname: "Cicero",
          agentType: "default",
          forkContext: false,
        }),
      }),
    ]);
    expect(store.workItemsFor("parent-session")).toMatchObject([
      {
        id: "codex-child-thread",
        kind: "agent",
        status: "running",
        title: "Review the auth boundary",
      },
    ]);

    const spawned = store.subagentsFor("parent-session")[0]!;
    expect(spawned.avatarId).toEqual(expect.any(String));
    const avatarId = spawned.avatarId;
    const viewSessionId = (spawned as typeof spawned & { viewSessionId?: string })
      .viewSessionId;
    expect(viewSessionId).toEqual(expect.any(String));
    expect(store.sideTabs()).toEqual([
      expect.objectContaining({
        type: "subagent",
        payload: viewSessionId,
        label: "Cicero",
        avatarId,
      }),
    ]);
    expect(store.sideActiveId()).toBe(viewSessionId);
    expect(store.get(viewSessionId!)).toMatchObject({
      kind: "side",
      sideKind: "subagent",
      subagentAvatarId: avatarId,
      label: "Cicero",
      status: "running",
      subagent: {
        parentSessionId: "parent-session",
        parentAcpSessionId: "parent-codex-thread",
        inheritance: "fresh",
      },
    });
    expect(store.turnsFor(viewSessionId!)).toEqual([
      expect.objectContaining({
        promptText: "Review the auth boundary",
        assistantText: "",
        status: "running",
      }),
    ]);

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-wait",
        toolName: "wait_agent",
        status: "completed",
        rawInput: { targets: ["codex-child-thread"], timeout_ms: 60000 },
        rawOutput: {
          status: {
            "codex-child-thread": { completed: "CHILD_OK" },
          },
          timed_out: false,
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "codex-child-thread",
      avatarId,
      status: "complete",
      native: {
        provider: "codex",
        result: "CHILD_OK",
      },
    });
    expect(store.workItemsFor("parent-session")).toMatchObject([
      {
        id: "codex-child-thread",
        status: "completed",
        result: "CHILD_OK",
      },
    ]);
    expect(
      (store.subagentsFor("parent-session")[0] as SubagentActivity & {
        viewSessionId?: string;
      }).viewSessionId,
    ).toBe(viewSessionId);
    expect(store.sideTabs()).toHaveLength(1);
    expect(store.get(viewSessionId!)).toMatchObject({ status: "ready" });
    expect(store.turnsFor(viewSessionId!)).toEqual([
      expect.objectContaining({
        promptText: "Review the auth boundary",
        assistantText: "CHILD_OK",
        status: "complete",
      }),
    ]);

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-close",
        toolName: "close_agent",
        status: "completed",
        rawInput: { target: "codex-child-thread" },
        rawOutput: {
          previous_status: { completed: "CHILD_OK" },
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "codex-child-thread",
      status: "complete",
      native: {
        provider: "codex",
        closed: true,
      },
    });
  });

  test("routes Claude nested transcript into the existing native subagent view", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "claude-parent",
      acp_session_id: "claude-thread",
      agent_id: "claude-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-parent", "claude-parent", "Ask Claude to investigate");

    store.apply({
      type: "session.event",
      session_id: "claude-parent",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "task-parent",
        toolName: "Task",
        status: "in_progress",
        rawInput: { description: "Inspect the auth boundary" },
        _meta: {
          claudeCode: {
            subagent: true,
            toolResponse: { agentId: "claude-child" },
          },
        },
      },
    });

    store.apply({
      type: "session.event",
      session_id: "claude-parent",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "agent_message_chunk",
        _meta: { claudeCode: { parentToolUseId: "task-parent" } },
        content: { type: "text", text: "Child found the boundary." },
      },
    });

    const activity = store.subagentsFor("claude-parent")[0]!;
    expect(store.turnsFor("claude-parent")[0]?.assistantText).toBe("");
    expect(store.turnsFor(activity.viewSessionId)[0]).toMatchObject({
      assistantText: "Child found the boundary.",
      status: "running",
      events: [
        expect.objectContaining({
          payload: expect.objectContaining({
            sessionUpdate: "agent_message_chunk",
          }),
        }),
      ],
    });
  });

  test("attributes Claude AgentOutput usage to the existing child work item", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "claude-usage-parent",
      acp_session_id: "claude-usage-thread",
      agent_id: "claude-acp",
      cwd: "/repo",
    });
    store.registerTurn(
      "turn-usage-parent",
      "claude-usage-parent",
      "Ask Claude to inspect usage",
    );
    store.apply({
      type: "session.event",
      session_id: "claude-usage-parent",
      turn_id: "turn-usage-parent",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "task-usage-parent",
        toolName: "Task",
        status: "in_progress",
        rawInput: { description: "Inspect token accounting" },
        _meta: {
          claudeCode: {
            subagent: true,
            toolResponse: { agentId: "claude-usage-child" },
          },
        },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "claude-usage-parent",
      turn_id: "turn-usage-parent",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "task-usage-parent",
        title: "Agent",
        status: "completed",
        _meta: {
          claudeCode: {
            toolName: "Agent",
            toolResponse: {
              status: "completed",
              agentId: "claude-usage-child",
              agentType: "Explore",
              content: [{ type: "text", text: "Usage audit complete." }],
              totalTokens: 24,
              usage: {
                input_tokens: 12,
                output_tokens: 8,
                cache_read_input_tokens: 3,
                cache_creation_input_tokens: 1,
              },
            },
          },
        },
      },
    });

    expect(store.subagentsFor("claude-usage-parent")[0]).toMatchObject({
      childSessionId: "claude-usage-child",
      status: "complete",
      native: {
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          cachedReadTokens: 3,
          cachedWriteTokens: 1,
          totalTokens: 24,
        },
      },
    });
    expect(store.openmaEventsFor("claude-usage-parent")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "usage.updated",
          work_item_id: "claude-usage-child",
          parent_id: "task-usage-parent",
        }),
      ]),
    );
  });

  test("marks native subagent views unknown when their parent turn lacks a child terminal", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-codex-thread",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-parent", "parent-session", "Start agent A");
    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "call-start-a",
        title: "Start subagent a",
        kind: "other",
        status: "completed",
        rawInput: {
          agentThreadId: "child-a",
          agentPath: "/root/a",
          activityKind: "started",
        },
        _meta: {
          codex: {
            subagent: {
              threadId: "child-a",
              path: "/root/a",
              activity: "started",
            },
          },
        },
      },
    });

    const viewSessionId = store.subagentsFor("parent-session")[0]!.viewSessionId;
    expect(store.turnsFor(viewSessionId)[0]).toMatchObject({
      status: "running",
    });

    store.apply({
      type: "session.complete",
      session_id: "parent-session",
      turn_id: "turn-parent",
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      status: "unknown",
    });
    expect(store.get(viewSessionId)).toMatchObject({ status: "ready" });
    expect(store.turnsFor(viewSessionId)[0]).toMatchObject({
      status: "unknown",
    });
    expect(store.workItemsFor("parent-session")).toEqual([
      expect.objectContaining({
        id: "child-a",
        status: "unknown",
        missing_terminal: true,
        reason: "parent_turn_completed",
      }),
    ]);
  });

  test("keeps split Codex spawn_agent output running until wait_agent completes", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-codex-thread",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-parent", "parent-session", "Spawn a native Codex subagent");

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "call-spawn",
        toolName: "spawn_agent",
        status: "pending",
        rawInput: {
          agent_type: "default",
          fork_context: true,
          message: "Compare native session protocols",
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "codex:call-spawn",
      status: "running",
    });
    expect(store.subagentsFor("parent-session")).toHaveLength(1);
    const initialActivity = store.subagentsFor("parent-session")[0]!;
    expect(initialActivity.avatarId).toEqual(expect.any(String));
    const initialAvatarId = initialActivity.avatarId;
    const initialViewSessionId = (
      initialActivity as typeof initialActivity & { viewSessionId?: string }
    ).viewSessionId;
    expect(initialViewSessionId).toEqual(expect.any(String));
    expect(store.sideTabs()).toEqual([
      expect.objectContaining({
        type: "subagent",
        payload: initialViewSessionId,
        label: "Curie",
        avatarId: initialAvatarId,
      }),
    ]);

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-spawn",
        status: "completed",
        rawOutput: {
          agent_id: "codex-child-thread",
          nickname: "Cicero",
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "codex-child-thread",
      avatarId: initialAvatarId,
      inheritance: "fork",
      task: "Compare native session protocols",
      status: "running",
      native: {
        provider: "codex",
        childThreadId: "codex-child-thread",
        nickname: "Cicero",
      },
    });
    expect(store.subagentsFor("parent-session")).toHaveLength(1);
    expect(store.sideTabs()).toHaveLength(1);
    expect(
      (store.subagentsFor("parent-session")[0] as SubagentActivity & {
        viewSessionId?: string;
      }).viewSessionId,
    ).toBe(initialViewSessionId);
    expect(store.sideTabs()[0]).toMatchObject({
      payload: initialViewSessionId,
      label: "Cicero",
      avatarId: initialAvatarId,
    });
  });

  test("does not treat Codex-shaped tools from unknown agents as Codex events", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-thread",
      agent_id: "agent",
      cwd: "/repo",
    });
    store.setActive("parent-session");
    store.registerTurn("turn-parent", "parent-session", "Ask a native Codex agent");

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "call-spawn",
        title: "spawnAgent",
        status: "completed",
        rawInput: {
          forkContext: true,
          message: "Explore the architecture",
        },
        rawOutput: {
          agent_id: "codex-child-thread",
          nickname: "Jason",
        },
      },
    });

    expect(store.subagentsFor("parent-session")).toEqual([]);
    expect(store.sideTabs()).toEqual([]);
  });

  test.each([
    ["OpenCode", "opencode", "opencode"],
    ["Kilo", "kilo", "kilo"],
  ])(
    "tracks %s foreground Task only after structured parent/child identity is confirmed",
    (_name, agentId, provider) => {
      const store = new SessionStore();
      const parentId = `${agentId}-foreground-parent`;
      const turnId = `${agentId}-foreground-turn`;
      const toolCallId = `${agentId}-foreground-task-call`;
      store.apply({
        type: "session.ready",
        session_id: parentId,
        acp_session_id: `${agentId}-acp-parent`,
        agent_id: agentId,
        cwd: "/repo",
      });
      store.registerTurn(turnId, parentId, "Run a foreground audit");

      store.apply({
        type: "session.event",
        session_id: parentId,
        turn_id: turnId,
        event: {
          sessionUpdate: "tool_call",
          toolCallId,
          title: "Audit source handling",
          kind: "think",
          status: "pending",
          rawInput: {
            description: "Audit source handling",
            prompt: "Inspect the source pipeline",
            subagent_type: "explore",
            background: false,
          },
        },
      });

      expect(store.subagentsFor(parentId)).toEqual([]);

      store.apply({
        type: "session.event",
        session_id: parentId,
        turn_id: turnId,
        event: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "completed",
          rawOutput: {
            output:
              `<task id="${agentId}-foreground-child" state="completed">`
              + "<task_result>Audit passed.</task_result></task>",
            metadata: {
              parentSessionId: `${agentId}-acp-parent`,
              sessionId: `${agentId}-foreground-child`,
            },
          },
        },
      });

      expect(store.subagentsFor(parentId)).toEqual([
        expect.objectContaining({
          childSessionId: `${agentId}-foreground-child`,
          status: "complete",
          native: expect.objectContaining({
            provider,
            toolCallId,
            childThreadId: `${agentId}-foreground-child`,
          }),
        }),
      ]);
      expect(store.workItemsFor(parentId)).toEqual([
        expect.objectContaining({
          id: `${agentId}-foreground-child`,
          status: "completed",
        }),
      ]);
      expect(
        store.openmaEventsFor(parentId).map((event) => event.type),
      ).toEqual(["work_item.completed"]);
    },
  );

  test.each([
    ["OpenCode", "opencode", "opencode"],
    ["Kilo", "kilo", "kilo"],
  ])(
    "keeps %s background Task terminal unknown when assistant text claims completion",
    (_name, agentId, provider) => {
      const store = new SessionStore();
      store.apply({
        type: "session.ready",
        session_id: `${agentId}-parent`,
        acp_session_id: `${agentId}-acp-parent`,
        agent_id: agentId,
        cwd: "/repo",
      });
      store.registerTurn(
        `${agentId}-turn`,
        `${agentId}-parent`,
        "Start a background audit",
      );

      store.apply({
        type: "session.event",
        session_id: `${agentId}-parent`,
        turn_id: `${agentId}-turn`,
        event: {
          sessionUpdate: "tool_call",
          toolCallId: `${agentId}-task-call`,
          title: "Audit source handling",
          kind: "think",
          status: "pending",
          rawInput: {
            description: "Audit source handling",
            prompt: "Inspect the source pipeline",
            subagent_type: "explore",
            background: true,
          },
        },
      });
      store.apply({
        type: "session.event",
        session_id: `${agentId}-parent`,
        turn_id: `${agentId}-turn`,
        event: {
          sessionUpdate: "tool_call_update",
          toolCallId: `${agentId}-task-call`,
          status: "completed",
          rawOutput: {
            output:
              `<task id="${agentId}-child" state="running">`
              + "<task_result>Working</task_result></task>",
            metadata: {
              parentSessionId: `${agentId}-acp-parent`,
              sessionId: `${agentId}-child`,
              background: true,
              jobId: `${agentId}-child`,
            },
          },
        },
      });

      expect(store.subagentsFor(`${agentId}-parent`)).toEqual([
        expect.objectContaining({
          childSessionId: `${agentId}-child`,
          task: "Audit source handling",
          status: "running",
          native: expect.objectContaining({
            provider,
            toolCallId: `${agentId}-task-call`,
            childThreadId: `${agentId}-child`,
            agentType: "explore",
          }),
        }),
      ]);

      for (const text of [
        `<task id="${agentId}-child" state="comp`,
        'leted"><summary>Background task completed: Audit source handling</summary>',
        "<task_result>Audit passed.</task_result></task>",
      ]) {
        store.apply({
          type: "session.event",
          session_id: `${agentId}-parent`,
          turn_id: `${agentId}-turn`,
          event: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        });
      }
      store.apply({
        type: "session.complete",
        session_id: `${agentId}-parent`,
        turn_id: `${agentId}-turn`,
      });

      expect(store.subagentsFor(`${agentId}-parent`)).toEqual([
        expect.objectContaining({
          childSessionId: `${agentId}-child`,
          status: "unknown",
          native: expect.objectContaining({
            provider,
          }),
        }),
      ]);
    },
  );

  test("tracks Claude Code Task tool invocations as native subagent activity", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-claude-thread",
      agent_id: "claude-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-parent", "parent-session", "Ask a native Claude agent");

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        type: "agent.tool_use",
        id: "toolu-task",
        name: "Task",
        input: {
          subagent_type: "general-purpose",
          description: "Audit native subagent protocol",
          prompt: "Inspect Codex and Claude native subagent events.",
        },
      },
    });

    expect(store.subagentsFor("parent-session")).toEqual([
      expect.objectContaining({
        childSessionId: "claude:toolu-task",
        parentSessionId: "parent-session",
        parentAcpSessionId: "parent-claude-thread",
        inheritance: "fresh",
        task: "Audit native subagent protocol",
        status: "running",
        native: expect.objectContaining({
          provider: "claude",
          toolCallId: "toolu-task",
          agentType: "general-purpose",
        }),
      }),
    ]);
    expect(store.subagentsFor("parent-session")[0]?.native?.childThreadId).toBeUndefined();

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "toolu-child-read",
        rawInput: { file_path: "/repo/src/main.ts" },
        _meta: {
          claudeCode: {
            toolName: "Read",
            parentToolUseId: "toolu-task",
          },
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]?.native).toMatchObject({
      provider: "claude",
      toolCallId: "toolu-task",
      childToolCallIds: ["toolu-child-read"],
    });

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu-task",
        status: "completed",
        rawOutput: [
          {
            type: "text",
            text: "Async agent launched successfully.\nagentId: text-only",
          },
        ],
        _meta: {
          claudeCode: {
            toolName: "Agent",
            toolResponse: {
              isAsync: true,
              status: "async_launched",
              agentId: "claude-child-agent",
              description: "Audit native subagent protocol",
              prompt: "Inspect Codex and Claude native subagent events.",
            },
          },
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "claude-child-agent",
      status: "running",
      native: {
        provider: "claude",
        childThreadId: "claude-child-agent",
      },
    });

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        type: "agent.tool_result",
        tool_use_id: "toolu-task",
        content: [
          {
            type: "text",
            text: "Findings ready.\nagentId: claude-child-agent (use SendMessage with to: 'claude-child-agent' to continue this agent)",
          },
        ],
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "claude-child-agent",
      status: "complete",
      native: {
        provider: "claude",
        result: expect.stringContaining("Findings ready."),
      },
    });
  });

  test("reidentifies the provisional Claude Agent work item when agentId arrives", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "claude-reidentify-parent",
      acp_session_id: "claude-reidentify-acp",
      agent_id: "claude-acp",
      cwd: "/repo",
    });
    store.registerTurn(
      "claude-reidentify-turn",
      "claude-reidentify-parent",
      "Start an async agent",
    );
    store.apply({
      type: "session.event",
      session_id: "claude-reidentify-parent",
      turn_id: "claude-reidentify-turn",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "toolu-async-agent",
        status: "pending",
        rawInput: { description: "Audit adapters" },
        _meta: { claudeCode: { toolName: "Agent", subagent: true } },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "claude-reidentify-parent",
      turn_id: "claude-reidentify-turn",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu-async-agent",
        status: "completed",
        _meta: {
          claudeCode: {
            toolName: "Agent",
            toolResponse: {
              isAsync: true,
              status: "async_launched",
              agentId: "claude-agent-1",
            },
          },
        },
      },
    });

    expect(store.workItemsFor("claude-reidentify-parent")).toEqual([
      expect.objectContaining({
        id: "claude-agent-1",
        kind: "agent",
        title: "Audit adapters",
        status: "running",
      }),
    ]);
  });

  test("marks a Claude async Agent unknown when its parent turn has no terminal event", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "claude-missing-terminal-parent",
      acp_session_id: "claude-missing-terminal-acp",
      agent_id: "claude-acp",
      cwd: "/repo",
    });
    store.registerTurn(
      "claude-missing-terminal-turn",
      "claude-missing-terminal-parent",
      "Start an async agent",
    );
    store.apply({
      type: "session.event",
      session_id: "claude-missing-terminal-parent",
      turn_id: "claude-missing-terminal-turn",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "toolu-missing-terminal",
        status: "pending",
        rawInput: { description: "Monitor the build" },
        _meta: { claudeCode: { toolName: "Agent", subagent: true } },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "claude-missing-terminal-parent",
      turn_id: "claude-missing-terminal-turn",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu-missing-terminal",
        status: "completed",
        _meta: {
          claudeCode: {
            toolName: "Agent",
            toolResponse: {
              isAsync: true,
              status: "async_launched",
              agentId: "claude-agent-missing-terminal",
            },
          },
        },
      },
    });

    store.apply({
      type: "session.complete",
      session_id: "claude-missing-terminal-parent",
      turn_id: "claude-missing-terminal-turn",
    });

    expect(store.workItemsFor("claude-missing-terminal-parent")).toEqual([
      expect.objectContaining({
        id: "claude-agent-missing-terminal",
        status: "unknown",
        reason: "parent_turn_completed",
        missing_terminal: true,
      }),
    ]);
  });

  test("does not infer native subagents from non-native tool names", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-generic-thread",
      agent_id: "gemini-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-parent", "parent-session", "Run a generic tool");

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        type: "agent.tool_use",
        id: "toolu-task",
        name: "Task",
        input: {
          description: "This is just a tool name in another adapter",
          prompt: "Do not treat this as Claude Code native subagent protocol.",
        },
      },
    });

    expect(store.subagentsFor("parent-session")).toEqual([]);
  });
});

describe("SessionStore pair chat grouping", () => {
  test("renames a session locally and persists the new title", async () => {
    const rename = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { backchat: { sessionsRename: rename } });
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "rename-session",
      acp_session_id: "acp-rename-session",
      agent_id: "codex-acp",
      cwd: "/tmp/rename-session",
    });

    await store.rename("rename-session", "Renamed task");

    expect(store.get("rename-session")?.label).toBe("Renamed task");
    expect(rename).toHaveBeenCalledWith({
      session_id: "rename-session",
      title: "Renamed task",
    });
  });

  test("renames a pair and persists the wrapper title", async () => {
    const pairSave = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { backchat: { pairSave } });
    const store = new SessionStore();
    const pairId = store.newDraftPair(["pair-test-codex", "pair-test-claude"]);

    await store.renamePair(pairId, "Renamed pair");

    expect(store.pair(pairId)?.label).toBe("Renamed pair");
    expect(pairSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ pair_id: pairId, title: "Renamed pair" }),
    );
  });

  test("keeps pinned pairs first and removes archived pairs from the list", () => {
    vi.stubGlobal("window", {
      backchat: {
        pairSave: vi.fn().mockResolvedValue(undefined),
        pairsPin: vi.fn().mockResolvedValue(undefined),
        pairsArchive: vi.fn().mockResolvedValue(undefined),
      },
    });
    const store = new SessionStore();
    const first = store.newDraftPair(["pair-first-a", "pair-first-b"]);
    const second = store.newDraftPair(["pair-second-a", "pair-second-b"]);
    store.pair(second)!.lastUsedAt += 1_000;

    store.pinPair(first);

    expect(store.pairList().map((pair) => pair.id)).toEqual([first, second]);
    store.archivePair(first);
    expect(store.pairList().map((pair) => pair.id)).toEqual([second]);
  });

  test("creates one normal turn per pair member for a shared prompt", () => {
    const store = new SessionStore();
    const pairId = store.newDraftPair([
      "pair-test-codex",
      "pair-test-claude",
    ]);
    const pair = store.pair(pairId);

    expect(pair?.members).toHaveLength(2);

    const targets = store.registerPairTurn(pairId, "Compare approaches");

    expect(targets).toHaveLength(2);
    expect(new Set(targets?.map((target) => target.turn_id)).size).toBe(2);

    for (const target of targets ?? []) {
      expect(store.turnsFor(target.session_id)).toMatchObject([
        {
          id: target.turn_id,
          promptText: "Compare approaches",
          status: "running",
        },
      ]);
    }

    expect(store.pair(pairId)?.activeTurnId).toBeTruthy();

    store.apply({
      type: "session.complete",
      session_id: targets?.[0]?.session_id ?? "",
      turn_id: targets?.[0]?.turn_id ?? "",
    });

    expect(store.pair(pairId)?.activeTurnId).toBeTruthy();

    store.apply({
      type: "session.complete",
      session_id: targets?.[1]?.session_id ?? "",
      turn_id: targets?.[1]?.turn_id ?? "",
    });

    expect(store.pair(pairId)?.activeTurnId).toBeUndefined();
  });

  test("persists pair grouping metadata through the app API", () => {
    const store = new SessionStore();
    const pairSave = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      backchat: { pairSave },
    });

    const pairId = store.newDraftPair([
      "pair-persist-codex",
      "pair-persist-claude",
    ]);

    expect(pairSave).toHaveBeenCalledWith(
      expect.objectContaining({
        pair_id: pairId,
        members: store.pair(pairId)?.members.map((session_id) =>
          expect.objectContaining({ session_id }),
        ),
      }),
    );
  });
});

describe("SessionStore Browser plugin rail sync", () => {
  test("opens, updates, and removes controlled IAB tabs from browser state events", () => {
    const store = new SessionStore();
    store.registerStarting("sess-main", "codex-acp", "Main chat");
    store.setActive("sess-main");

    store.syncBrowserPluginState({
      type: "browser.state",
      browser: {
        id: "backchat-iab",
        type: "iab",
        name: "Backchat In-app Browser",
        capabilities: { browser: [], tab: [] },
      },
      visible: true,
      activeTabId: "1",
      tabs: [
        {
          id: "1",
          title: "Probe",
          url: "http://127.0.0.1:5173/",
        },
      ],
    });

    expect(store.sideTabs()).toEqual([
      expect.objectContaining({
        type: "browser",
        label: "127.0.0.1",
        payload: "http://127.0.0.1:5173/",
        source: {
          kind: "browser-plugin",
          browserId: "backchat-iab",
          tabId: "1",
        },
      }),
    ]);
    const tabId = store.sideTabs()[0]?.id;
    expect(store.activeSideTabId()).toBe(tabId);

    store.syncBrowserPluginState({
      type: "browser.state",
      browser: {
        id: "backchat-iab",
        type: "iab",
        name: "Backchat In-app Browser",
        capabilities: { browser: [], tab: [] },
      },
      visible: true,
      activeTabId: "1",
      tabs: [
        {
          id: "1",
          title: "Next",
          url: "https://example.com/next",
        },
      ],
    });

    expect(store.sideTabs()).toHaveLength(1);
    expect(store.sideTabs()[0]).toEqual(
      expect.objectContaining({
        id: tabId,
        label: "example.com",
        payload: "https://example.com/next",
      }),
    );

    store.syncBrowserPluginState({
      type: "browser.state",
      browser: {
        id: "backchat-iab",
        type: "iab",
        name: "Backchat In-app Browser",
        capabilities: { browser: [], tab: [] },
      },
      visible: false,
      activeTabId: "1",
      tabs: [
        {
          id: "1",
          title: "Next",
          url: "https://example.com/next",
        },
      ],
    });

    expect(store.sideTabs()).toEqual([]);
  });

  test("ignores Chrome extension browser state for the in-app right rail", () => {
    const store = new SessionStore();
    store.registerStarting("sess-main", "codex-acp", "Main chat");
    store.setActive("sess-main");

    store.syncBrowserPluginState({
      type: "browser.state",
      browser: {
        id: "chrome-extension",
        type: "extension",
        name: "Chrome Extension",
        capabilities: { browser: [], tab: [] },
      },
      visible: true,
      activeTabId: "7",
      tabs: [
        {
          id: "7",
          title: "Chrome",
          url: "https://example.com/",
        },
      ],
    });

    expect(store.sideTabs()).toEqual([]);
  });
});
