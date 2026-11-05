import { test } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { SessionStore, selectSessions, selectTurnsFor } from "./session-store";

test.skipIf(!process.env.BACKCHAT_MEM_BREAKDOWN)("phase heap breakdown", () => {
  const sessions = 100, turnsPerSession = 200, longTurns = 3000, chunks = 20000, structuralEvents = 500;
  const history = (n: number) => Array.from({ length: n }, (_, i) => [
    { seq: i * 2 + 1, type: "user_prompt", data: JSON.stringify({ text: `Question ${i}` }), ts: i * 2 + 1 },
    { seq: i * 2 + 2, type: "agent_message_chunk", data: JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Answer ${i}.\n\n` + "Paragraph with **formatting** and `code`.\n\n".repeat(8) } }), ts: i * 2 + 2 },
  ]).flat();
  const mb = () => { global.gc?.(); return process.memoryUsage().heapUsed / 1048576; };
  const rows = history(turnsPerSession);
  global.gc?.();
  const t0 = mb();
  const store = new SessionStore();
  const tNew = mb();
  for (let s = 0; s < sessions; s++) {
    store.registerStarting(`s${s}`, "codex-acp", `Session ${s}`);
    store.replayHistoryWindow(`s${s}`, rows, { hasMore: false });
  }
  const tSetup = mb();
  store.registerStarting("long", "codex-acp", "Long");
  store.replayHistoryWindow("long", history(longTurns), { hasMore: false });
  const tLong = mb();
  for (let s = 0; s < sessions; s++) store.registerTurn(`live${s}`, `s${s}`, "Stream");
  const tLiveReg = mb();
  for (let i = 0; i < chunks; i++) {
    store.apply({ type: "session.event", session_id: `s${i % sessions}`, turn_id: `live${i % sessions}`, event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "chunk " } } });
  }
  const tStream = mb();
  for (let i = 0; i < structuralEvents; i++) {
    store.apply({ type: "session.event", session_id: `s${i % sessions}`, turn_id: `live${i % sessions}`, event: { sessionUpdate: "tool_call", toolCallId: `tool${i}`, title: "Read file", status: "completed" } });
    store.apply({ type: "session.event", session_id: `s${i % sessions}`, turn_id: `live${i % sessions}`, event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "chunk " } } });
  }
  const tStruct = mb();
  // Would-be: complete all live turns (attribution only — not changing stress)
  for (let s = 0; s < sessions; s++) {
    store.apply({ type: "session.complete", session_id: `s${s}`, turn_id: `live${s}` });
  }
  const tComplete = mb();
  const out = {
    empty: +t0.toFixed(2),
    afterNew: +tNew.toFixed(2),
    afterSetup100x200: +tSetup.toFixed(2),
    afterLong3000: +tLong.toFixed(2),
    afterLiveRegister: +tLiveReg.toFixed(2),
    afterStream: +tStream.toFixed(2),
    afterStructural: +tStruct.toFixed(2),
    afterCompleteLive: +tComplete.toFixed(2),
    deltas: {
      setup: +(tSetup - tNew).toFixed(2),
      long: +(tLong - tSetup).toFixed(2),
      liveReg: +(tLiveReg - tLong).toFixed(2),
      stream: +(tStream - tLiveReg).toFixed(2),
      structural: +(tStruct - tStream).toFixed(2),
      completeLive: +(tComplete - tStruct).toFixed(2),
    },
  };
  mkdirSync("artifacts/perf-stress-20261105", { recursive: true });
  writeFileSync("artifacts/perf-stress-20261105/mem-breakdown-wave2b.json", JSON.stringify(out, null, 2));
  console.log("BREAKDOWN", JSON.stringify(out));
}, 120_000);
