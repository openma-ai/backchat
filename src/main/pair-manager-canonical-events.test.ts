import { describe, expect, it, vi } from "vitest";

import { createOpenMAEvent } from "@openma/common/session-events/openma";
import { PairManager } from "./pair-manager.js";
import type { SessionManager } from "./session-manager.js";

vi.mock("./sql-store.js", () => ({
  getSessionConfigValues: vi.fn(() => ({})),
  setSessionConfigValue: vi.fn(),
  listPairMembers: vi.fn(() => []),
  setPairTitleIfEmpty: vi.fn(),
  touchPairSession: vi.fn(),
  upsertPairSession: vi.fn(),
  upsertSession: vi.fn(),
}));

describe("PairManager canonical session transport", () => {
  it("preserves ready capabilities and canonical session events for pair members", async () => {
    const pairEvents: unknown[] = [];
    const manager = new PairManager({
      sessionManager: {
        start: vi.fn(async () => ({ status: "ready" })),
      } as unknown as SessionManager,
      pairSink: (event) => pairEvents.push(event),
    });
    await manager.startPair({
      pair_id: "pair-1",
      members: [{ session_id: "member-1", agent_id: "codex-acp" }],
    });

    const started = createOpenMAEvent({
      event_id: "member-session-started",
      type: "session.started",
      session_id: "member-1",
      source: { kind: "harness", harness: "codex-acp", adapter: "acp" },
      occurred_at: "2026-08-05T00:00:00.000Z",
      data: { capabilities: { session_list: true, session_close: true } },
    });
    manager.routeOrPassthrough({
      type: "session.ready",
      session_id: "member-1",
      acp_session_id: "acp-member-1",
      agent_id: "codex-acp",
      cwd: "/repo",
      config_options: [{ id: "model", type: "select" }],
      supports_session_list: true,
      supports_session_close: true,
      openma_event: started,
    });

    expect(pairEvents).toContainEqual({
      type: "pair.ready",
      pair_id: "pair-1",
      members: [expect.objectContaining({
        session_id: "member-1",
        config_options: [{ id: "model", type: "select" }],
        supports_session_list: true,
        supports_session_close: true,
        openma_event: started,
      })],
    });

    const message = createOpenMAEvent({
      event_id: "member-message",
      type: "agent.message_chunk",
      session_id: "member-1",
      turn_id: "turn-1",
      source: { kind: "harness", harness: "codex-acp", adapter: "acp" },
      occurred_at: "2026-08-05T00:00:01.000Z",
      data: { text: "hello" },
    });
    manager.routeOrPassthrough({
      type: "session.event",
      session_id: "member-1",
      turn_id: "turn-1",
      event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
      openma_event: message,
    });

    expect(pairEvents).toContainEqual(expect.objectContaining({
      type: "pair.event",
      pair_id: "pair-1",
      member_session_id: "member-1",
      openma_event: message,
    }));

    const completed = createOpenMAEvent({
      event_id: "member-turn-completed",
      type: "turn.completed",
      session_id: "member-1",
      turn_id: "turn-1",
      source: { kind: "harness", harness: "codex-acp", adapter: "acp" },
      occurred_at: "2026-08-05T00:00:02.000Z",
      data: { stop_reason: "end_turn", usage: { totalTokens: 12 } },
    });
    manager.routeOrPassthrough({
      type: "session.complete",
      session_id: "member-1",
      turn_id: "turn-1",
      stop_reason: "end_turn",
      usage: { totalTokens: 12, inputTokens: 7, outputTokens: 5 },
      openma_event: completed,
    });
    expect(pairEvents).toContainEqual(expect.objectContaining({
      type: "pair.complete",
      member_session_id: "member-1",
      stop_reason: "end_turn",
      usage: { totalTokens: 12, inputTokens: 7, outputTokens: 5 },
      openma_event: completed,
    }));

    const background = createOpenMAEvent({
      event_id: "member-background-started",
      type: "work_item.started",
      session_id: "member-1",
      work_item_id: "terminal-1",
      source: { kind: "harness", harness: "codex-acp", adapter: "acp-terminal" },
      occurred_at: "2026-08-05T00:00:03.000Z",
      data: { kind: "bash", title: "pnpm test" },
    });
    const backgroundTransport = {
      type: "session.background_process" as const,
      session_id: "member-1",
      process_id: "terminal-1",
      seq: 1,
      phase: "started" as const,
      command: "pnpm",
      args: ["test"],
      openma_event: background,
    };
    manager.routeOrPassthrough(backgroundTransport);
    expect(pairEvents).toContainEqual({
      type: "pair.session_event",
      pair_id: "pair-1",
      member_session_id: "member-1",
      session_event: backgroundTransport,
    });
  });
});
