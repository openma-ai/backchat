import { describe, expect, it } from "vitest";
import { streamEventsFromSession } from "./live-bus.js";
import { rememberPermissionDecision } from "../permission-policy.js";
import { sessionTurnSummary, transcriptFromHistory } from "./transcript.js";
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

  it("merges text chunks and keeps tool, turn, and permission markers", () => {
    const events = transcriptFromHistory([
      row(1, "openma_event", { type: "agent.message_chunk", data: { text: "Hel" } }),
      row(2, "openma_event", { type: "agent.message_chunk", data: { text: "lo" } }),
      row(3, "openma_event", {
        type: "tool.started",
        data: { tool_name: "edit", tool_call_id: "call-9", title: "Edit file" },
      }),
      row(4, "permission_request", { request_id: "perm-1", title: "Edit file", kind: "edit" }),
      row(5, "permission_response", { request_id: "perm-1", option_id: "allow", outcome: "selected", title: "Edit file" }),
      row(6, "openma_event", { type: "turn.completed", data: {} }),
      row(7, "turn_cancelled", { turn_id: "t" }),
    ]);
    expect(events[0]).toMatchObject({ type: "text", text: "Hello", cursor: "2" });
    expect(events[1]).toMatchObject({ type: "tool_call", name: "edit", status: "start", tool_call_id: "call-9" });
    expect(events[2]).toMatchObject({ type: "permission", status: "pending", request_id: "perm-1" });
    expect(events[3]).toMatchObject({ type: "permission", status: "selected", name: "allow" });
    expect(events[4]).toMatchObject({ type: "status", status: "complete" });
    expect(events[5]).toMatchObject({ type: "status", status: "cancelled" });
  });

  it("does not treat a completed tool status as success", () => {
    const events = transcriptFromHistory([
      row(1, "openma_event", {
        type: "tool.completed",
        data: {
          tool_call_id: "edit-1",
          status: "completed",
          raw_output: "Write permission denied",
        },
      }),
      row(2, "permission_request", { request_id: "perm-2", tool_call_id: "shell-1", title: "echo" }),
      row(3, "permission_response", {
        request_id: "perm-2",
        tool_call_id: "shell-1",
        option_id: "reject-once",
        option_kind: "reject_once",
        outcome: "rejected",
      }),
      row(4, "openma_event", {
        type: "tool.completed",
        data: { tool_call_id: "shell-1", status: "completed" },
      }),
      row(5, "openma_event", {
        type: "tool.completed",
        data: { tool_call_id: "edit-2", status: "completed", raw_output: { path: "ok.md" } },
      }),
      row(6, "openma_event", {
        type: "tool.completed",
        data: { tool_call_id: "mystery", status: "completed" },
      }),
    ]);

    expect(events.map((event) => event.status)).toEqual([
      "denied",
      "pending",
      "rejected",
      "denied",
      "completed",
      "finished",
    ]);
    expect(streamEventsFromSession({
      type: "session.event",
      session_id: "sess",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "edit-1",
        status: "completed",
        rawOutput: "Write permission denied",
      },
    })[0]).toMatchObject({ status: "end", outcome: "denied" });
    expect(streamEventsFromSession({
      type: "session.event",
      session_id: "sess",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "mystery",
        status: "completed",
      },
    })[0]).toMatchObject({ status: "end", outcome: "finished" });
  });

  it("reports a rejected shell as denied on the stream when the tool only says completed", () => {
    rememberPermissionDecision("sess-stream", "shell-1", {
      outcome: "rejected",
      optionKind: "reject_once",
      optionId: "reject-once",
    });
    expect(streamEventsFromSession({
      type: "session.event",
      session_id: "sess-stream",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "shell-1",
        kind: "execute",
        status: "completed",
      },
    })[0]).toMatchObject({ status: "end", outcome: "denied" });
  });

  it("reports the last turn outcome and reply", () => {
    expect(sessionTurnSummary([
      row(1, "openma_event", {
        type: "agent.message_chunk",
        turn_id: "t1",
        data: { text: "Hi" },
      }),
      row(2, "openma_event", { type: "turn.completed", turn_id: "t1", data: {} }),
    ])).toEqual({ outcome: "complete", reply: "Hi" });
  });
});
