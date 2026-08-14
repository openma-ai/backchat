import { describe, expect, it } from "vitest";
import type { ManagedAgentsLabEvent } from "@shared/managed-agents-lab";
import {
  initialManagedAgentsLabState,
  reduceManagedAgentsLabEvent,
  type ManagedAgentsLabViewState,
} from "./managed-agents-lab-state";

type WithoutEnvelope<T> = T extends unknown ? Omit<T, "runId" | "at"> : never;
type EventPayload = WithoutEnvelope<ManagedAgentsLabEvent>;

function event(
  value: EventPayload,
  runId = "run-1",
): ManagedAgentsLabEvent {
  return { ...value, runId, at: 1 } as ManagedAgentsLabEvent;
}

describe("Managed Agents Lab event projection", () => {
  it("builds readable output while preserving the raw SDK timeline", () => {
    let state: ManagedAgentsLabViewState = {
      ...initialManagedAgentsLabState,
      runId: "run-1",
    };
    state = reduceManagedAgentsLabEvent(state, event({
      kind: "http",
      method: "GET",
      path: "/v1/sessions/sess/events/stream?beta=true",
      status: 200,
      durationMs: 24,
    }));
    state = reduceManagedAgentsLabEvent(state, event({
      kind: "sdk_event",
      type: "event_start",
      data: { type: "event_start", event: { type: "agent.message", id: "msg-1" } },
    }));
    state = reduceManagedAgentsLabEvent(state, event({
      kind: "sdk_event",
      type: "event_delta",
      data: {
        type: "event_delta",
        event_id: "msg-1",
        delta: { content: { type: "text", text: "Hello " } },
      },
    }));
    state = reduceManagedAgentsLabEvent(state, event({
      kind: "sdk_event",
      type: "event_delta",
      data: {
        type: "event_delta",
        event_id: "msg-1",
        delta: { content: { type: "text", text: "from cloud." } },
      },
    }));

    expect(state.answer).toBe("Hello from cloud.");
    expect(state.http).toHaveLength(1);
    expect(state.sdkEvents.map((item) => item.type)).toEqual([
      "event_start",
      "event_delta",
      "event_delta",
    ]);
  });

  it("ignores late events from an earlier run", () => {
    const state = { ...initialManagedAgentsLabState, runId: "run-2" };
    const next = reduceManagedAgentsLabEvent(state, event({
      kind: "error",
      message: "old failure",
    }, "run-1"));
    expect(next).toBe(state);
  });
});
