import { describe, expect, it } from "vitest";
import { SessionStore } from "./session-store";

describe("steer rich input replay", () => {
  it("uses ordinary pending/failure/retry feedback before steer acknowledgement", () => {
    const store = new SessionStore();
    store.apply({ type: "session.ready", session_id: "session", acp_session_id: "acp", agent_id: "codex-acp", cwd: "/repo" });
    store.registerTurn("active", "session", "Original");
    store.registerTurn("steer", "session", "Change direction", {
      intent: "steer", requestedDelivery: "llm_boundary",
      effectiveDelivery: "llm_boundary", degraded: false,
    });
    const input = () => store.turnsFor("session").find(turn => turn.id === "steer");
    expect(input()).toMatchObject({ sendState: "pending", promptText: "Change direction" });
    store.failSend("steer", "Connection lost");
    expect(input()).toMatchObject({ sendState: "failed", sendError: "Connection lost" });
    expect(store.turnsFor("session").find(turn => turn.id === "active")?.status).toBe("running");
    store.reopenSend("steer");
    expect(input()).toMatchObject({ sendState: "pending", clientId: "steer" });
  });

  it("preserves images and input time in the same active turn in live and replay", () => {
    const image = { id: "image", name: "screen.png", kind: "image", mimeType: "image/png", path: "/tmp/screen.png", uri: "file:///tmp/screen.png" };
    const event = { schema_version: "oma.event.v1" as const, event_id: "steer", session_id: "session", turn_id: "steer-turn", occurred_at: "2026-10-23T05:01:00.000Z", source: { kind: "user" as const }, type: "user.message" as const, data: { text: "Look", input_kind: "steering", outcome: "injected", active_turn_id: "active", attachments: [image] } };
    const live = new SessionStore();
    live.apply({ type: "session.ready", session_id: "session", acp_session_id: "acp", agent_id: "codex-acp", cwd: "/repo" });
    live.registerTurn("active", "session", "Original");
    live.apply({ type: "session.steering", session_id: "session", turn_id: "steer-turn", active_turn_id: "active", text: "Look", requested_delivery: "llm_boundary", effective_delivery: "llm_boundary", outcome: "injected", openma_event: event });
    const replay = new SessionStore();
    replay.replayHistory("session", [
      { seq: 1, type: "openma_event", data: JSON.stringify({ ...event, event_id: "prompt", turn_id: "active", data: { text: "Original", input_kind: "prompt" } }), ts: 1 },
      { seq: 2, type: "openma_event", data: JSON.stringify(event), ts: 2 },
    ]);
    const liveInput = live.projectTurn(live.turnsFor("session")[0]!).timeline.filter(item => item.kind === "user_input");
    const replayInput = replay.projectTurn(replay.turnsFor("session")[0]!).timeline.filter(item => item.kind === "user_input");
    expect(liveInput).toEqual([{ kind: "user_input", text: "Look", clientId: "steer-turn", attachments: [image], startedAt: "2026-10-23T05:01:00.000Z" }]);
    expect(replayInput).toEqual(liveInput);
    expect(live.turnsFor("session").map(turn => turn.id)).toEqual(["active"]);
    expect(replay.turnsFor("session").map(turn => turn.id)).toEqual(["active"]);
  });
});
