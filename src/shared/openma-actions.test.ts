import { describe, expect, it } from "vitest";
import { openmaPendingActions } from "./openma-actions";
describe("OpenMA pending actions", () => {
  it("uses the server's requested IDs and reconciles confirmation or custom results", () => {
    const events = [
      { type: "agent.tool_use", id: "tool", name: "bash", input: { command: "deploy" } },
      { type: "agent.custom_tool_use", id: "question", name: "Question", input: { question: "Which branch?" } },
      { type: "session.status_idle", id: "idle", stop_reason: { type: "requires_action", event_ids: ["tool", "question"] } },
    ];
    expect(openmaPendingActions(events)).toMatchObject([{ id: "tool", type: "confirmation" }, { id: "question", type: "custom_result" }]);
    expect(openmaPendingActions([...events, { type: "user.tool_confirmation", tool_use_id: "tool", result: "deny" }])).toMatchObject([{ id: "question" }]);
    expect(openmaPendingActions([...events, { type: "session.status_running" }])).toEqual([]);
  });
});
