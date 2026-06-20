import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionStore } from "./session-store";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sessionStore.replayHistory", () => {
  it("replays persisted assistant chunks exactly once", () => {
    const sessionId = "sess-replay-history-dedupe";

    sessionStore.replayHistory(sessionId, [
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

    expect(sessionStore.turnsFor(sessionId)).toHaveLength(1);
    expect(sessionStore.turnsFor(sessionId)[0]?.assistantText).toBe("Rendered once.");
  });
});

describe("sessionStore session config", () => {
  it("stores session-scoped config option updates without a turn", () => {
    const sessionId = "sess-config-option-update";
    sessionStore.registerStarting(sessionId, "codex-acp", "Config test");

    sessionStore.apply({
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

    expect(sessionStore.get(sessionId)?.configOptions?.[0]?.currentValue).toBe(
      "gpt-5",
    );
  });
});

describe("sessionStore prompt queue state", () => {
  it("keeps the active turn running and marks later turns queued", () => {
    const sessionId = "sess-queue-state";
    sessionStore.registerStarting(sessionId, "codex-acp", "Queue test");
    sessionStore.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-queue-state",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    sessionStore.registerTurn("turn-active", sessionId, "first");
    sessionStore.registerTurn("turn-queued", sessionId, "second");

    expect(sessionStore.get(sessionId)?.activeTurnId).toBe("turn-active");
    expect(
      (sessionStore.get(sessionId) as { queuedTurnIds?: string[] } | undefined)
        ?.queuedTurnIds,
    ).toEqual(["turn-queued"]);
    expect(sessionStore.turnsFor(sessionId).map((turn) => turn.status)).toEqual([
      "running",
      "queued",
    ]);

    sessionStore.apply({
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-active",
    });

    expect(sessionStore.get(sessionId)?.activeTurnId).toBe("turn-queued");
    expect(sessionStore.get(sessionId)?.status).toBe("running");
    expect(sessionStore.turnsFor(sessionId).map((turn) => turn.status)).toEqual([
      "complete",
      "running",
    ]);

    sessionStore.apply({
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-queued",
    });

    expect(sessionStore.get(sessionId)?.activeTurnId).toBeUndefined();
    expect(sessionStore.get(sessionId)?.status).toBe("ready");
  });

  it("records requested and effective delivery for queued prompts", () => {
    const sessionId = "sess-queue-delivery";
    sessionStore.registerStarting(sessionId, "codex-acp", "Queue delivery test");
    sessionStore.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-queue-delivery",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    sessionStore.registerTurn("turn-active-delivery", sessionId, "first", {
      intent: "submit",
      requestedDelivery: "turn_end",
      effectiveDelivery: "turn_end",
      degraded: false,
    });
    sessionStore.registerTurn("turn-steer-degraded", sessionId, "steer me", {
      intent: "steer",
      requestedDelivery: "llm_boundary",
      effectiveDelivery: "turn_end",
      degraded: true,
    });

    const degraded = sessionStore
      .turnsFor(sessionId)
      .find((turn) => turn.id === "turn-steer-degraded");

    expect(degraded?.status).toBe("queued");
    expect(degraded?.promptIntent).toBe("steer");
    expect(degraded?.requestedDelivery).toBe("llm_boundary");
    expect(degraded?.effectiveDelivery).toBe("turn_end");
    expect(degraded?.deliveryDegraded).toBe(true);
  });
});

describe("sessionStore pair chat grouping", () => {
  it("creates one normal turn per pair member for a shared prompt", () => {
    const pairId = sessionStore.newDraftPair([
      "pair-test-codex",
      "pair-test-claude",
    ]);
    const pair = sessionStore.pair(pairId);

    expect(pair?.members).toHaveLength(2);

    const targets = sessionStore.registerPairTurn(pairId, "Compare approaches");

    expect(targets).toHaveLength(2);
    expect(new Set(targets?.map((t) => t.turn_id)).size).toBe(2);

    for (const target of targets ?? []) {
      expect(sessionStore.turnsFor(target.session_id)).toMatchObject([
        {
          id: target.turn_id,
          promptText: "Compare approaches",
          status: "running",
        },
      ]);
    }

    expect(sessionStore.pair(pairId)?.activeTurnId).toBeTruthy();

    sessionStore.apply({
      type: "session.complete",
      session_id: targets?.[0]?.session_id ?? "",
      turn_id: targets?.[0]?.turn_id ?? "",
    });

    expect(sessionStore.pair(pairId)?.activeTurnId).toBeTruthy();

    sessionStore.apply({
      type: "session.complete",
      session_id: targets?.[1]?.session_id ?? "",
      turn_id: targets?.[1]?.turn_id ?? "",
    });

    expect(sessionStore.pair(pairId)?.activeTurnId).toBeUndefined();
  });

  it("persists pair grouping metadata through the app API", () => {
    const pairSave = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      backchat: { pairSave },
    });

    const pairId = sessionStore.newDraftPair([
      "pair-persist-codex",
      "pair-persist-claude",
    ]);

    expect(pairSave).toHaveBeenCalledWith(
      expect.objectContaining({
        pair_id: pairId,
        members: sessionStore.pair(pairId)?.members.map((session_id) =>
          expect.objectContaining({ session_id }),
        ),
      }),
    );
  });
});
