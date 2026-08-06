import { describe, expect, it, vi } from "vitest";

import {
  createSessionEventEnricher,
  shouldPersistSessionEvent,
} from "./session-event-enricher.js";
import * as sessionEventEnricherModule from "./session-event-enricher.js";

describe("session event canonical enricher", () => {
  it("keeps startup snapshots ephemeral but retains ACP updates that occurred in a turn", () => {
    const ephemeral = [
      "session.started",
      "command_catalog.updated",
      "config.updated",
      "capability.updated",
      "session.running",
      "session.idle",
      "turn.queued",
    ];
    for (const type of ephemeral) {
      expect(shouldPersistSessionEvent({ type } as never)).toBe(false);
    }
    expect(shouldPersistSessionEvent({
      type: "command_catalog.updated",
      turn_id: "turn-live",
    } as never)).toBe(true);
    expect(shouldPersistSessionEvent({
      type: "usage.updated",
      turn_id: "turn-live",
    } as never)).toBe(true);
    for (const type of [
      "user.message",
      "agent.message_chunk",
      "agent.thinking",
      "tool.started",
      "turn.completed",
      "session.error",
    ]) {
      expect(shouldPersistSessionEvent({ type } as never)).toBe(true);
    }
  });

  it("hands one canonical ACP envelope with raw evidence to the delivery boundary", () => {
    const enrich = createSessionEventEnricher(
      () => "2026-08-05T00:00:00.000Z",
    );

    const result = enrich({
      type: "session.event",
      session_id: "sess-persist",
      turn_id: "turn-persist",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "durable" },
      },
    });

    expect(result.openma_event).toMatchObject({
      schema: "oma.event.v1",
      type: "agent.message_chunk",
      session_id: "sess-persist",
      turn_id: "turn-persist",
      seq: 1,
      raw: {
        kind: "raw",
        source: "acp",
        method: "session/update",
        event_type: "agent_message_chunk",
        payload: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "durable" },
        },
      },
    });
  });

  it("attributes later ACP updates to the harness learned from session.ready", () => {
    const enrich = createSessionEventEnricher(() => "2026-08-05T00:00:00.000Z");
    enrich({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "pi-acp",
      cwd: "/repo",
    });

    const result = enrich({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "done" },
      },
    });

    expect(result.openma_event).toMatchObject({
      type: "agent.message_chunk",
      source: { kind: "harness", harness: "pi-acp", adapter: "acp" },
      data: { text: "done" },
    });
  });

  it("assigns distinct canonical ids to repeated identical ACP chunks", () => {
    const enrich = createSessionEventEnricher(() => "2026-08-05T00:00:00.000Z");
    enrich({
      type: "session.ready",
      session_id: "sess-repeat",
      acp_session_id: "acp-repeat",
      agent_id: "pi-acp",
      cwd: "/repo",
    });
    const chunk = {
      type: "session.event" as const,
      session_id: "sess-repeat",
      turn_id: "turn-repeat",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "same" },
      },
    };

    const first = enrich(chunk).openma_event;
    const second = enrich(chunk).openma_event;

    expect(first?.event_id).not.toBe(second?.event_id);
    expect([first?.seq, second?.seq]).toEqual([2, 3]);
  });

  it("keeps canonical ids bounded when ACP updates contain large extension metadata", () => {
    const enrich = createSessionEventEnricher(() => "2026-08-05T00:00:00.000Z");
    const result = enrich({
      type: "session.event",
      session_id: "sess-large-meta",
      turn_id: "turn-large-meta",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "done" },
        _meta: { claudeCode: { providerPayload: "x".repeat(50_000) } },
      },
    });

    expect(result.openma_event?.event_id.length).toBeLessThanOrEqual(256);
    expect(result.openma_event?.raw).toMatchObject({
      payload: {
        _meta: { claudeCode: { providerPayload: "x".repeat(50_000) } },
      },
    });
  });

  it("continues canonical sequence numbers after a desktop restart", () => {
    const initialSequence = vi.fn(() => 41);
    const enrich = createSessionEventEnricher(
      () => "2026-08-05T00:00:00.000Z",
      initialSequence,
    );

    const result = enrich({
      type: "session.event",
      session_id: "sess-resumed-sequence",
      turn_id: "turn-after-restart",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "continued" },
      },
    });

    expect(initialSequence).toHaveBeenCalledOnce();
    expect(initialSequence).toHaveBeenCalledWith("sess-resumed-sequence");
    expect(result.openma_event?.seq).toBe(42);
  });

  it("finds the highest persisted canonical sequence across current and legacy schema keys", () => {
    const latestSequence = (
      sessionEventEnricherModule as unknown as {
        latestPersistedOpenMAEventSequence?: (
          rows: Array<{ type: string; data: string }>,
        ) => number;
      }
    ).latestPersistedOpenMAEventSequence;

    expect(latestSequence?.([
      { type: "user_prompt", data: JSON.stringify({ text: "legacy" }) },
      {
        type: "openma_event",
        data: JSON.stringify({ schema_version: "oma.event.v1", seq: 7 }),
      },
      { type: "openma_event", data: "not-json" },
      {
        type: "openma_event",
        data: JSON.stringify({ schema_version: "oma.event.v1", seq: 41 }),
      },
      {
        type: "openma_event",
        data: JSON.stringify({ schema: "oma.event.v1", seq: 52 }),
      },
      {
        type: "openma_event",
        data: JSON.stringify({ schema_version: "oma.event.v1", seq: -1 }),
      },
    ])).toBe(52);
  });

  it("advances past a higher sequence attached by a harness adapter", () => {
    const enrich = createSessionEventEnricher(
      () => "2026-08-05T00:00:00.000Z",
      () => 4,
    );
    const adapterEvent = {
      schema_version: "oma.event.v1" as const,
      event_id: "adapter-seq-100",
      type: "vendor.event" as const,
      session_id: "sess-adapter-sequence",
      source: { kind: "harness" as const, harness: "codex", adapter: "codex" },
      occurred_at: "2026-08-05T00:00:00.000Z",
      seq: 100,
      data: {
        kind: "vendor" as const,
        harness: "codex",
        namespace: "codex",
        name: "child_event",
        data: {},
      },
    };

    enrich({
      type: "session.event",
      session_id: "sess-adapter-sequence",
      turn_id: "turn-adapter",
      event: { sessionUpdate: "future_event" },
      openma_event: adapterEvent,
    });
    const next = enrich({
      type: "session.event",
      session_id: "sess-adapter-sequence",
      turn_id: "turn-next",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "next" },
      },
    });

    expect(next.openma_event?.seq).toBe(101);
  });

  it("assigns a sequence while preserving a canonical event attached by an adapter", () => {
    const enrich = createSessionEventEnricher(() => "2026-08-05T00:00:00.000Z");
    const existing = {
      schema_version: "oma.event.v1" as const,
      event_id: "adapter-event",
      type: "vendor.event" as const,
      session_id: "sess-1",
      source: { kind: "harness" as const, harness: "cursor", adapter: "cursor" },
      occurred_at: "2026-08-05T00:00:00.000Z",
      data: {
        kind: "vendor" as const,
        harness: "cursor",
        namespace: "cursor",
        name: "task",
        data: {},
      },
    };

    const result = enrich({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: { sessionUpdate: "future_event" },
      openma_event: existing,
    });

    expect(result.openma_event).toEqual({
      ...existing,
      seq: 1,
    });
  });

  it("forgets the harness after the session is disposed", () => {
    const enrich = createSessionEventEnricher(() => "2026-08-05T00:00:00.000Z");
    enrich({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "pi-acp",
      cwd: "/repo",
    });
    enrich({ type: "session.disposed", session_id: "sess-1" });

    const result = enrich({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-after-dispose",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "late" },
      },
    });

    expect(result.openma_event).toMatchObject({
      source: { kind: "harness", harness: "unknown", adapter: "acp" },
    });
  });
});
