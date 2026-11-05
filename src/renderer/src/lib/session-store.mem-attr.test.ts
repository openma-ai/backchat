import { test } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { SessionStore } from "./session-store";

test.skipIf(!process.env.BACKCHAT_MEM_ATTR)("setup-only memory attribution", () => {
  const sessions = 100, turnsPerSession = 200;
  const history = (n: number) => Array.from({ length: n }, (_, i) => [
    { seq: i * 2 + 1, type: "user_prompt", data: JSON.stringify({ text: `Question ${i}` }), ts: i * 2 + 1 },
    { seq: i * 2 + 2, type: "agent_message_chunk", data: JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Answer ${i}.\n\n` + "Paragraph with **formatting** and `code`.\n\n".repeat(8) } }), ts: i * 2 + 2 },
  ]).flat();
  const rows = history(turnsPerSession);
  global.gc?.();
  const before = process.memoryUsage();
  const store = new SessionStore();
  for (let s = 0; s < sessions; s++) {
    store.registerStarting(`s${s}`, "codex-acp", `Session ${s}`);
    store.replayHistoryWindow(`s${s}`, rows, { hasMore: false });
  }
  global.gc?.();
  const after = process.memoryUsage();
  const liveEqualLen = store.turnsFor("s0").filter((t, i) => {
    const u = store.turnsFor("s1")[i];
    return u && t.events[0] === u.events[0];
  }).length;
  const out = {
    heapDeltaMB: +((after.heapUsed - before.heapUsed) / 1048576).toFixed(1),
    heapAfterMB: +(after.heapUsed / 1048576).toFixed(1),
    rssDeltaMB: +((after.rss - before.rss) / 1048576).toFixed(1),
    eventShared01: store.turnsFor("s0")[0]!.events[0] === store.turnsFor("s1")[0]!.events[0],
    liveEqualLen,
    checkedOnS0: turnsPerSession,
  };
  mkdirSync("artifacts/perf-stress-20261105", { recursive: true });
  writeFileSync("artifacts/perf-stress-20261105/mem-attr-wave2b.json", JSON.stringify(out, null, 2));
  console.log("MEM_ATTR", JSON.stringify(out));
}, 120_000);
