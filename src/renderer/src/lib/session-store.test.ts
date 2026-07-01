import { afterEach, describe, expect, test, vi } from "vitest";
import { SessionStore, type AcpSessionConfigOption } from "./session-store";

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

describe("SessionStore event reducers", () => {
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

  test("records requested and effective delivery for queued prompts", () => {
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
    store.registerTurn("turn-steer-degraded", sessionId, "steer me", {
      intent: "steer",
      requestedDelivery: "llm_boundary",
      effectiveDelivery: "turn_end",
      degraded: true,
    });

    const degraded = store
      .turnsFor(sessionId)
      .find((turn) => turn.id === "turn-steer-degraded");

    expect(degraded?.status).toBe("queued");
    expect(degraded?.promptIntent).toBe("steer");
    expect(degraded?.requestedDelivery).toBe("llm_boundary");
    expect(degraded?.effectiveDelivery).toBe("turn_end");
    expect(degraded?.deliveryDegraded).toBe(true);
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
});

describe("SessionStore pair chat grouping", () => {
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
