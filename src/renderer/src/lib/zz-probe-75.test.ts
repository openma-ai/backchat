import { describe, expect, test } from "vitest";
import { SessionStore } from "./session-store";

const sid = "sess-75";
const T = "turn-tm6xfd7d";
const chunk = (text: string, id = "m1") => ({ sessionUpdate: "agent_message_chunk", messageId: id, content: { type: "text", text } });
const guardianStart = (r: string, target: string) => ({ sessionUpdate: "tool_call", toolCallId: `guardian_assessment:${r}`, kind: "think", title: "Guardian Review", status: "in_progress", rawInput: { action: { type: "execve", program: "/bin/ls", argv: ["/bin/ls"], cwd: "/p" } }, content: [{ type: "content", content: { type: "text", text: `Action: ${target}` } }] });
const guardianDone = (r: string) => ({ sessionUpdate: "tool_call_update", toolCallId: `guardian_assessment:${r}`, status: "completed", content: [{ type: "content", content: { type: "text", text: "Status: Approved" } }] });
const exec = (id: string, status = "pending") => ({ sessionUpdate: "tool_call", toolCallId: id, kind: "execute", title: `run ${id}`, status, rawInput: { command: ["ls"] } });
const execDone = (id: string) => ({ sessionUpdate: "tool_call_update", toolCallId: id, status: "completed" });

const seq = [
  chunk("First message part one. "), chunk("part two."),
  guardianStart("r0", "x"), guardianDone("r0"),
  exec("c1"), guardianStart("r1", "c1"), exec("c2"), guardianStart("r2", "c2"),
  guardianDone("r2"), execDone("c2"), guardianDone("r1"), execDone("c1"),
  chunk("Second message.", "m2"),
  exec("c3"), execDone("c3"),
  chunk("Final.", "m3"),
];

describe("probe #75", () => {
  for (const steering of [false, true]) {
    test(`live steering=${steering}`, () => {
      const store = new SessionStore();
      store.registerStarting(sid, "codex-acp", "x");
      store.apply({ type: "session.ready", session_id: sid, acp_session_id: "a", agent_id: "codex-acp", cwd: "/p", supports_steering: true } as never);
      store.registerTurn(T, sid, "do it");
      store.apply({ type: "session.queue_update", session_id: sid, mode: "single", active_turn_id: T, queued: [] } as never);
      seq.forEach((event, i) => {
        if (steering && i === 2) {
          store.registerTurn("turn-steer", sid, "also this", { intent: "steer", requestedDelivery: "llm_boundary", effectiveDelivery: "llm_boundary", degraded: false } as never);
          store.apply({ type: "session.steering", session_id: sid, turn_id: "turn-steer", active_turn_id: T, text: "also this", requested_delivery: "llm_boundary", effective_delivery: "llm_boundary", outcome: "injected" } as never);
        }
        store.apply({ type: "session.event", session_id: sid, turn_id: T, event } as never);
      });
      console.log(JSON.stringify(store.turnsFor(sid).map((t) => ({ id: t.id, status: t.status, prompt: t.promptText, n: t.events.length, text: t.assistantText }))));
      expect(true).toBe(true);
    });
  }
});
