import { describe, expect, it, vi } from "vitest";

import type { SessionEventOut } from "../shared/session-events.js";
import { deliverSessionEvent } from "./session-event-delivery.js";

function event(type: string, turnId: string | null = "turn-delivery"): SessionEventOut {
  return {
    type: "session.event",
    session_id: "sess-delivery",
    turn_id: turnId ?? "",
    event: { sessionUpdate: "agent_message_chunk" },
    openma_event: {
      schema: "oma.event.v1",
      schema_version: "oma.event.v1",
      event_id: `event-${type}`,
      session_id: "sess-delivery",
      ...(turnId ? { turn_id: turnId } : {}),
      source: { kind: "harness", harness: "claude-acp", adapter: "acp" },
      occurred_at: "2026-08-06T00:00:00.000Z",
      type: type as never,
      data: {},
    },
  };
}

describe("session event delivery boundary", () => {
  it("publishes durable events before persistence", () => {
    const order: string[] = [];
    deliverSessionEvent(event("agent.message_chunk"), {
      publish: () => order.push("publish"),
      persist: () => order.push("persist"),
    });
    expect(order).toEqual(["publish", "persist"]);
  });

  it("publishes ephemeral snapshots without persisting them", () => {
    const publish = vi.fn();
    const persist = vi.fn();
    deliverSessionEvent(event("command_catalog.updated", null), { publish, persist });
    expect(publish).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();
  });

  it("keeps the live path successful when persistence fails", () => {
    const publish = vi.fn();
    const onPersistError = vi.fn();
    expect(() => deliverSessionEvent(event("agent.message_chunk"), {
      publish,
      persist: () => {
        throw new Error("disk unavailable");
      },
      onPersistError,
    })).not.toThrow();
    expect(publish).toHaveBeenCalledOnce();
    expect(onPersistError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ type: "agent.message_chunk" }),
    );
  });
});
