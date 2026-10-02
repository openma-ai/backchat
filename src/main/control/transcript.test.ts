import { describe, expect, it } from "vitest";
import { transcriptFromHistory } from "./transcript.js";
import type { PersistedEvent } from "../sql-store.js";

function row(seq: number, type: string, data: unknown, ts = 1_700_000_000_000 + seq): PersistedEvent {
  return { seq, session_id: "sess", type, data: JSON.stringify(data), ts };
}

describe("control transcript", () => {
  it("returns structured events with a stable cursor and honors --since", () => {
    const events = transcriptFromHistory([
      row(1, "user_prompt", { text: "hello" }),
      row(2, "openma_event", { type: "user.message", data: { text: "hello" } }),
      row(3, "openma_event", { type: "agent.message_chunk", data: { text: "Hi" } }),
      row(4, "openma_event", {
        type: "tool.call",
        data: { name: "read", toolCallId: "call-1" },
      }),
      row(5, "openma_event", {
        type: "tool.result",
        data: { toolCallId: "call-1", text: "file" },
      }),
    ]);

    expect(events.map((event) => event.cursor)).toEqual(["2", "3", "4", "5"]);
    expect(events[0]).toMatchObject({ role: "user", type: "text", text: "hello" });
    expect(events[1]).toMatchObject({ role: "assistant", type: "text", text: "Hi" });
    expect(events[2]).toMatchObject({ role: "tool", type: "tool_call", name: "read", tool_call_id: "call-1" });
    expect(events[3]).toMatchObject({ role: "tool", type: "tool_result", tool_call_id: "call-1" });
    expect(transcriptFromHistory([
      row(1, "user_prompt", { text: "hello" }),
      row(2, "openma_event", { type: "user.message", data: { text: "hello" } }),
      row(3, "openma_event", { type: "agent.message_chunk", data: { text: "Hi" } }),
    ], "2").map((event) => event.cursor)).toEqual(["3"]);
  });
});
