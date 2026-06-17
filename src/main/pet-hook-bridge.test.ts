import { describe, expect, it } from "vitest";
import { petHookEventForSessionEvent, PET_HOOK_ENDPOINT } from "./pet-hook-bridge.js";

describe("petHookEventForSessionEvent", () => {
  it("maps Backchat lifecycle events to structured pet hook events", () => {
    expect(
      petHookEventForSessionEvent({
        type: "session.complete",
        session_id: "sess 1",
        turn_id: "turn-1",
      }),
    ).toEqual({
      harness: "backchat",
      event: "session.completed",
      sessionId: "sess 1",
      turnId: "turn-1",
    });

    expect(
      petHookEventForSessionEvent({
        type: "session.error",
        session_id: "sess-1",
        turn_id: "turn-1",
        message: "Build failed",
      }),
    ).toEqual({
      harness: "backchat",
      event: "session.failed",
      sessionId: "sess-1",
      turnId: "turn-1",
      label: "Build failed",
    });
  });

  it("maps selected ACP updates without forwarding token chunks", () => {
    expect(
      petHookEventForSessionEvent({
        type: "session.event",
        session_id: "sess-1",
        turn_id: "turn-1",
        event: {
          sessionUpdate: "tool_call",
          kind: "execute",
          title: "Run tests",
          status: "in_progress",
        },
      }),
    ).toEqual({
      harness: "backchat",
      event: "tool.run",
      sessionId: "sess-1",
      turnId: "turn-1",
      label: "Run tests",
    });

    expect(
      petHookEventForSessionEvent({
        type: "session.event",
        session_id: "sess-1",
        turn_id: "turn-1",
        event: { sessionUpdate: "agent_message_chunk", content: "hello" },
      }),
    ).toBeNull();
  });

  it("uses localhost HTTP instead of OS deeplink as the hook bus", () => {
    expect(PET_HOOK_ENDPOINT).toBe("http://127.0.0.1:47632/hook");
  });
});
