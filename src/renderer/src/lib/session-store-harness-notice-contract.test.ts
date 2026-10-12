import { describe, expect, it } from "vitest";
import { toOpenMAEvent } from "@shared/openma-event.js";
import { SessionStore } from "./session-store.js";

const diagnosticWarning =
  "Warning: Codex couldn't save diagnostic logs to its local database. " +
  "Use /feedback with logs included before closing Codex, or run " +
  "`codex doctor` for diagnostics.";

const skillWarning =
  "Warning: Skill descriptions were shortened to fit the 2% skills context budget. " +
  "Codex can still see every skill, but some descriptions are shorter. " +
  "Disable unused skills or plugins to leave more room for the rest.";

const genuineReply =
  "Warning: Back up your database first.\n\nThen run the migration.";

function setupCompletedTurn(
  sessionId: string,
  agentId = "codex-acp",
): SessionStore {
  const store = new SessionStore();
  store.registerStarting(sessionId, agentId, agentId);
  store.registerTurn("turn-before-warning", sessionId, "Check this");
  store.apply({
    type: "session.event",
    session_id: sessionId,
    turn_id: "turn-before-warning",
    event: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "The answer is ready." },
    },
  });
  store.apply({
    type: "session.complete",
    session_id: sessionId,
    turn_id: "turn-before-warning",
  });
  return store;
}

function diagnosticEvent() {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: `${diagnosticWarning}\n\n` },
  };
}

describe("SessionStore Codex harness notices", () => {
  it.each([false, true])(
    "shows an out-of-turn diagnostic notice without creating a turn (canonical envelope: %s)",
    (withEnvelope) => {
      const sessionId = `sess-live-harness-notice-${withEnvelope}`;
      const store = setupCompletedTurn(sessionId);
      const beforeTurns = store.turnsFor(sessionId);
      const event = diagnosticEvent();

      store.apply({
        type: "session.event",
        session_id: sessionId,
        turn_id: "",
        event,
        ...(withEnvelope
          ? {
              openma_event: toOpenMAEvent({
                type: "session.event",
                session_id: sessionId,
                turn_id: "",
                event,
              }, {
                occurredAt: "2026-10-10T00:00:00.000Z",
                harness: "codex-acp",
                adapter: "acp",
              })!,
            }
          : {}),
      });

      expect(store.turnsFor(sessionId)).toHaveLength(beforeTurns.length);
      expect(store.turnsFor(sessionId)[0]?.assistantText).toBe(
        "The answer is ready.",
      );
      expect(store.get(sessionId)?.notice).toMatchObject({
        message: diagnosticWarning,
        tone: "warning",
      });
    },
  );

  it("splits an in-turn skill warning and keeps the following answer", () => {
    const sessionId = "sess-live-skill-warning";
    const store = setupCompletedTurn(sessionId);
    store.registerTurn("turn-skill-warning", sessionId, "Inspect this");

    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: "turn-skill-warning",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `${skillWarning}\n\n` },
      },
    });
    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: "turn-skill-warning",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "The project is ready." },
      },
    });

    expect(store.get(sessionId)?.notice).toMatchObject({
      message: skillWarning,
      tone: "warning",
    });
    expect(store.turnsFor(sessionId).find((turn) =>
      turn.id === "turn-skill-warning"
    )?.assistantText).toBe("The project is ready.");
  });

  it.each(["claude-acp", "codex-acp"] as const)(
    "renders a warning-like in-turn reply from %s as assistant text",
    (agentId) => {
      const sessionId = `sess-live-warning-like-reply-${agentId}`;
      const store = setupCompletedTurn(sessionId, agentId);
      const turnId = `turn-warning-like-reply-${agentId}`;
      store.registerTurn(turnId, sessionId, "Back up the database");
      store.apply({
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: genuineReply },
        },
      });

      expect(store.get(sessionId)?.notice).toBeUndefined();
      expect(
        store.turnsFor(sessionId).find((turn) => turn.id === turnId)
          ?.assistantText,
      ).toBe(genuineReply);
    },
  );

  it("renders final-answer warning wording as assistant text", () => {
    const sessionId = "sess-live-final-warning";
    const store = setupCompletedTurn(sessionId);
    store.registerTurn("turn-final-warning", sessionId, "Continue");

    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: "turn-final-warning",
      event: {
        sessionUpdate: "agent_message_chunk",
        _meta: { codex: { phase: "final_answer" } },
        content: { type: "text", text: "Warning: keep a backup.\n\n" },
      },
    });

    expect(store.get(sessionId)?.notice).toBeUndefined();
    expect(store.turnsFor(sessionId).find((turn) =>
      turn.id === "turn-final-warning"
    )?.assistantText).toBe("Warning: keep a backup.\n\n");
  });

  it("replays a legacy canonical out-of-turn diagnostic row as a notice", () => {
    const sessionId = "sess-replay-harness-notice";
    const occurredAt = "2026-10-10T00:00:00.000Z";
    const rawEvent = diagnosticEvent();
    const canonical = (input: {
      eventId: string;
      turnId?: string;
      type: "agent.message_chunk" | "turn.completed";
      data: Record<string, unknown>;
      raw?: Record<string, unknown>;
    }) => ({
      schema: "oma.event.v1",
      event_id: input.eventId,
      session_id: sessionId,
      ...(input.turnId !== undefined ? { turn_id: input.turnId } : {}),
      source: { kind: "harness", harness: "codex-acp", adapter: "acp" },
      occurred_at: occurredAt,
      type: input.type,
      data: input.data,
      ...(input.raw ? { raw: input.raw } : {}),
    });
    const store = new SessionStore();
    store.registerStarting(sessionId, "codex-acp", "Codex");

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Check this" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "openma_event",
        data: JSON.stringify(canonical({
          eventId: "answer-before-warning",
          turnId: "turn-before-warning",
          type: "agent.message_chunk",
          data: { text: "The answer is ready." },
        })),
        ts: 1_001,
      },
      {
        seq: 3,
        type: "openma_event",
        data: JSON.stringify(canonical({
          eventId: "completed-before-warning",
          turnId: "turn-before-warning",
          type: "turn.completed",
          data: {},
        })),
        ts: 1_002,
      },
      {
        seq: 4,
        type: "openma_event",
        data: JSON.stringify(canonical({
          eventId: "out-of-turn-warning",
          turnId: "",
          type: "agent.message_chunk",
          data: { text: `${diagnosticWarning}\n\n` },
          raw: {
            kind: "raw",
            source: "acp",
            method: "session/update",
            event_type: "agent_message_chunk",
            payload: rawEvent,
            received_at: occurredAt,
            reason: "unknown",
          },
        })),
        ts: 1_003,
      },
    ]);

    expect(store.turnsFor(sessionId)).toHaveLength(1);
    expect(store.turnsFor(sessionId)[0]?.assistantText).toBe(
      "The answer is ready.",
    );
    expect(store.get(sessionId)?.notice).toMatchObject({
      message: diagnosticWarning,
      tone: "warning",
    });
  });

  it("still splits a coalesced legacy skill-warning row during replay", () => {
    const sessionId = "sess-replay-skill-warning-contract";
    const store = new SessionStore();
    store.registerStarting(sessionId, "codex-acp", "Codex");

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Inspect this" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "agent.message",
        data: JSON.stringify({
          schema: "oma.event.v1",
          event_id: "coalesced-skill-warning",
          session_id: sessionId,
          source: { kind: "harness", harness: "codex-acp", adapter: "acp" },
          occurred_at: "2026-10-10T00:00:01.000Z",
          type: "agent.message",
          data: { text: `${skillWarning}\n\nThe project is ready.` },
        }),
        ts: 1_001,
      },
    ]);

    expect(store.get(sessionId)?.notice).toMatchObject({
      message: skillWarning,
      tone: "warning",
    });
    expect(store.turnsFor(sessionId)[0]?.assistantText).toBe(
      "The project is ready.",
    );
  });

  it("splits a coalesced legacy agent_message row with Codex provenance", () => {
    const sessionId = "sess-replay-legacy-agent-message-warning";
    const store = new SessionStore();
    store.registerStarting(sessionId, "codex-acp", "Codex");

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Inspect this" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "agent_message",
        data: JSON.stringify({
          text: `${skillWarning}\n\nThe project is ready.`,
        }),
        ts: 1_001,
      },
    ]);

    expect(store.get(sessionId)?.notice).toMatchObject({
      message: skillWarning,
      tone: "warning",
    });
    expect(store.turnsFor(sessionId)[0]?.assistantText).toBe(
      "The project is ready.",
    );
  });

  it("classifies an exact warning envelope in legacy raw replay for Codex", () => {
    const sessionId = "sess-replay-legacy-raw-warning";
    const store = new SessionStore();
    store.registerStarting(sessionId, "codex-acp", "Codex");

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Inspect this" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "agent_message_chunk",
        data: JSON.stringify(diagnosticEvent()),
        ts: 1_001,
      },
    ]);

    expect(store.get(sessionId)?.notice).toMatchObject({
      message: diagnosticWarning,
      tone: "warning",
    });
    expect(store.turnsFor(sessionId)[0]?.assistantText).toBe("");
  });

  it("replays an in-turn Codex warning-like reply as assistant text", () => {
    const sessionId = "sess-replay-warning-like-reply";
    const store = new SessionStore();
    store.registerStarting(sessionId, "codex-acp", "Codex");

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Back up the database" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "openma_event",
        data: JSON.stringify({
          schema: "oma.event.v1",
          event_id: "warning-like-reply",
          session_id: sessionId,
          turn_id: "turn-warning-like-reply",
          source: { kind: "harness", harness: "codex-acp", adapter: "acp" },
          occurred_at: "2026-10-10T00:00:01.000Z",
          type: "agent.message_chunk",
          data: { text: genuineReply },
        }),
        ts: 1_001,
      },
    ]);

    expect(store.get(sessionId)?.notice).toBeUndefined();
    expect(store.turnsFor(sessionId)[0]?.assistantText).toBe(genuineReply);
  });

  it("replays final-answer warning wording as assistant text", () => {
    const sessionId = "sess-replay-final-warning";
    const store = new SessionStore();
    store.registerStarting(sessionId, "codex-acp", "Codex");

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Continue" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "openma_event",
        data: JSON.stringify({
          schema: "oma.event.v1",
          event_id: "final-answer-warning",
          session_id: sessionId,
          turn_id: "turn-final-warning",
          source: { kind: "harness", harness: "codex-acp", adapter: "acp" },
          occurred_at: "2026-10-10T00:00:01.000Z",
          type: "agent.message_chunk",
          data: {
            text: "Warning: keep a backup.\n\n",
            phase: "final_answer",
          },
          raw: {
            kind: "raw",
            source: "acp",
            method: "session/update",
            event_type: "agent_message_chunk",
            payload: {
              sessionUpdate: "agent_message_chunk",
              _meta: { codex: { phase: "final_answer" } },
              content: {
                type: "text",
                text: "Warning: keep a backup.\n\n",
              },
            },
            received_at: "2026-10-10T00:00:01.000Z",
            reason: "unknown",
          },
        }),
        ts: 1_001,
      },
    ]);

    expect(store.get(sessionId)?.notice).toBeUndefined();
    expect(store.turnsFor(sessionId)[0]?.assistantText).toBe(
      "Warning: keep a backup.\n\n",
    );
  });
});
