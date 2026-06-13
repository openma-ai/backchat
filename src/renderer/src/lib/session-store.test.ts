import { describe, expect, it } from "vitest";
import { sessionStore } from "./session-store";

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
