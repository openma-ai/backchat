import { test, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { execFileSync } from "node:child_process";
import { SessionStore, selectSessions, selectTurnsFor } from "./session-store";

const phase = process.env.BACKCHAT_PERF_PHASE;
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)], min: sorted[0], max: sorted.at(-1), samples: values };
};

// Opt-in diagnostic. No machine-specific latency gate; assertions verify the workload.
test.skipIf(!phase)("high-load store: history, session churn, parallel streaming and structural bursts", () => {
  const sessions = 100, turnsPerSession = 200, longTurns = 3000, chunks = 20000, structuralEvents = 500, switches = 500;
  const rounds: Record<string, unknown>[] = [];
  function runRound(round: number) {
    global.gc?.();
    const memoryBefore = process.memoryUsage();
    const store = new SessionStore();
    const history = (n: number) => Array.from({ length: n }, (_, i) => [
      { seq: i * 2 + 1, type: "user_prompt", data: JSON.stringify({ text: `Question ${i}` }), ts: i * 2 + 1 },
      { seq: i * 2 + 2, type: "agent_message_chunk", data: JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Answer ${i}.\n\n` + "Paragraph with **formatting** and `code`.\n\n".repeat(8) } }), ts: i * 2 + 2 },
    ]).flat();
    const rows = history(turnsPerSession);
    const cpuSetupStart = process.cpuUsage();
    const setupStart = performance.now();
    for (let s = 0; s < sessions; s++) {
      store.registerStarting(`s${s}`, "codex-acp", `Session ${s}`);
      store.replayHistoryWindow(`s${s}`, rows, { hasMore: false });
    }
    store.registerStarting("long", "codex-acp", "Long transcript");
    const longRows = history(longTurns);
    const cpuReplayStart = process.cpuUsage();
    const replayStart = performance.now();
    store.replayHistoryWindow("long", longRows, { hasMore: false });
    const longReplayMs = performance.now() - replayStart;
    const cpuReplay = process.cpuUsage(cpuReplayStart);
    const setupMs = performance.now() - setupStart;
    const cpuSetup = process.cpuUsage(cpuSetupStart);
    expect(store.turnsFor("long")).toHaveLength(longTurns);
    for (let s = 0; s < sessions; s++) store.registerTurn(`live${s}`, `s${s}`, "Stream");
    const selectors = [selectTurnsFor("long"), selectTurnsFor("s0"), selectTurnsFor("s1")];
    let notifications = 0, listChanges = 0;
    let previousList = store.snapshot(selectSessions);
    const unsubscribe = store.subscribe(() => {
      notifications++;
      const list = store.snapshot(selectSessions);
      if (list !== previousList) listChanges++;
      previousList = list;
      for (const selector of selectors) store.snapshot(selector);
      store.turnsFor(store.activeId() ?? "s0");
    });
    const cpuSwitchStart = process.cpuUsage();
    const switchCost: number[] = [];
    for (let i = 0; i < switches; i++) {
      const start = performance.now();
      store.setActive(`s${i % sessions}`);
      switchCost.push(performance.now() - start);
    }
    const cpuSwitch = process.cpuUsage(cpuSwitchStart);
    const switchNotifications = notifications, switchListChanges = listChanges;
    const emitChunk = (i: number) => store.apply({ type: "session.event", session_id: `s${i % sessions}`, turn_id: `live${i % sessions}`, event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "chunk " } } });
    const cpuStreamingStart = process.cpuUsage();
    const burstStart = performance.now();
    for (let i = 0; i < chunks; i++) emitChunk(i);
    const streamingMs = performance.now() - burstStart;
    const cpuStreaming = process.cpuUsage(cpuStreamingStart);
    const cpuStructuralStart = process.cpuUsage();
    const structuralCost: number[] = [];
    for (let i = 0; i < structuralEvents; i++) {
      const start = performance.now();
      store.apply({ type: "session.event", session_id: `s${i % sessions}`, turn_id: `live${i % sessions}`, event: { sessionUpdate: "tool_call", toolCallId: `tool${i}`, title: "Read file", status: "completed" } });
      emitChunk(i);
      structuralCost.push(performance.now() - start);
    }
    const cpuStructural = process.cpuUsage(cpuStructuralStart);
    expect(store.turnsFor("s0").at(-1)?.assistantText).toBe("chunk ".repeat(chunks / sessions + structuralEvents / sessions));
    expect(switchListChanges).toBe(0);
    const cpuReadsStart = process.cpuUsage();
    const reads: number[] = [];
    for (let batch = 0; batch < 10; batch++) {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const id = `s${i % sessions}`;
        store.ensureHistoryMaterialized(id);
        expect(store.turnsFor(id)).toHaveLength(turnsPerSession + 1);
      }
      reads.push(performance.now() - start);
    }
    const cpuReads = process.cpuUsage(cpuReadsStart);
    // Reads rematerialize every session; park inactive histories before the
    // heap sample so MEMORY reflects the focused-session steady state.
    store.setActive("s0");
    const memoryBeforeGc = process.memoryUsage();
    global.gc?.();
    const memoryAfterGc = process.memoryUsage();
    expect(store.list()).toHaveLength(sessions + 1);
    const result = { cpu: { setup: cpuSetup, replay: cpuReplay, switch: cpuSwitch, streaming: cpuStreaming, structural: cpuStructural, reads: cpuReads }, memoryBefore, memoryBeforeGc, memoryAfterGc, warmup: round === 0, setupMs, longReplayMs, switches: summary(switchCost), streamingMs, structural: summary(structuralCost), read100: summary(reads), switchNotifications, switchListChanges, notifications, listChanges, memory: process.memoryUsage() };
    unsubscribe();
    return result;
  }
  for (let round = 0; round < 6; round++) rounds.push(runRound(round));
  const result = { phase, revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), envelope: { sessions, turnsPerSession, longTurns, chunks, structuralEvents, switches, warmupRounds: 1, measuredRounds: 5, subscribers: "list + 3 stable turn selectors + active turn read", workerCount: 1, explicitGc: typeof global.gc === "function", cpuUnits: "microseconds (user + system); measured separately from wall time", command: `BACKCHAT_PERF_PHASE=${phase} node_modules/.bin/vitest run src/renderer/src/lib/session-store.stress.test.ts --maxWorkers=1 --execArgv=--expose-gc`, node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model, cpuCount: cpus().length, cache: "fresh store per round; first round discarded; warm module/JIT", concurrentBenchmarks: 0 }, rounds };
  mkdirSync("artifacts/perf-stress-20261105", { recursive: true });
  writeFileSync(`artifacts/perf-stress-20261105/store-${phase}.json`, JSON.stringify(result, null, 2));
  console.log("STORE_STRESS", JSON.stringify(rounds.map(({ longReplayMs, streamingMs, switches, structural, read100 }) => ({ longReplayMs, streamingMs, switches, structural, read100 })), (_key, value) => Array.isArray(value) && typeof value[0] === "number" ? undefined : value));
}, 120_000);
