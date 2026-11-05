import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { test, expect } from "./fixtures";
import { injectEvent, persistSessionFixture } from "./helpers";

const phase = process.env.BACKCHAT_PERF_PHASE;
test.skip(!phase, "Opt-in diagnostic: set BACKCHAT_PERF_PHASE=baseline or after");

// Extends long-transcript-performance and interaction-performance using the same
// persisted fixtures, pointerdown-to-ready rAF and double-frame scroll proxy.
test("high-load history, parallel sessions, switching and streaming", async ({ page, app }, testInfo) => {
  test.setTimeout(240_000);
  const sessions = 24, turns = 500, smallTurns = 50;
  const events = (n: number, id: number) => Array.from({ length: n }, (_, i) => [
    { type: "user_prompt", data: { text: `Question ${id}/${i}` } },
    { type: "agent_message_chunk", data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Answer ${id}/${i}.\n\n` + "Paragraph with **formatting** and `code`.\n\n".repeat(8) } } },
  ]).flat();
  for (let s = 0; s < sessions; s++) {
    await persistSessionFixture(page, { sessionId: `stress-${s}`, title: `Stress session ${s}`, agentId: "codex-acp", cwd: "", acpSessionId: "", events: events(s === 0 ? turns : smallTurns, s) });
  }
  await page.addInitScript(() => {
    const metrics = { history: [] as { id: number; ms: number }[], longTasks: [] as number[], frames: [] as number[], skippedTurns: 0 };
    (window as unknown as { stressMetrics: typeof metrics }).stressMetrics = metrics;
    let target: number | null = null, started = 0;
    new PerformanceObserver(list => { for (const e of list.getEntries()) metrics.longTasks.push(e.duration); }).observe({ type: "longtask", buffered: true });
    document.addEventListener("contentvisibilityautostatechange", event => {
      if ((event as Event & { skipped: boolean }).skipped) metrics.skippedTurns++;
    }, true);
    document.addEventListener("pointerdown", event => {
      const label = (event.target as Element).closest("button")?.getAttribute("aria-label");
      const match = label?.match(/^Stress session (\d+)$/);
      if (match) { target = Number(match[1]); started = event.timeStamp; }
    }, true);
    new MutationObserver(() => {
      if (target === null || document.querySelector('[data-chat-history-loading="true"]')) return;
      const last = target === 0 ? 499 : 49;
      const text = document.querySelector(".chat-scrollbar")?.textContent ?? "";
      if (!text.includes(`Answer ${target}/${last}.`) && !text.includes(`Stream concurrently ${target}`)) return;
      const id = target, at = started;
      target = null;
      requestAnimationFrame(() => metrics.history.push({ id, ms: performance.now() - at }));
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-chat-history-loading"] });
  });
  console.log("STRESS_STAGE", "fixtures-persisted");
  await page.reload(); // Restore production animations, as in interaction-performance.
  const memory: unknown[] = [];
  const sampleMemory = async (stage: string) => memory.push({ stage, at: Date.now(), processes: await app.evaluate(({ app }) => app.getAppMetrics().map(({ pid, type, memory, cpu }) => ({ pid, type, memory, cpu }))) });
  await sampleMemory("ready");
  const profiler = process.env.BACKCHAT_PERF_PROFILE ? await page.context().newCDPSession(page) : undefined;
  if (profiler) { await profiler.send("Profiler.enable"); await profiler.send("Profiler.start"); }
  let streaming = false;
  const select = async (s: number) => {
    await page.getByRole("button", { name: `Stress session ${s}`, exact: true }).click();
    await expect(page.getByText(streaming ? `Stream concurrently ${s}` : `Answer ${s}/${s === 0 ? turns - 1 : smallTurns - 1}.`, { exact: true })).toBeVisible();
    await expect(page.locator('[data-chat-history-loading="true"]')).toHaveCount(0);
  };
  console.log("STRESS_STAGE", "long-history");
  await select(0);
  await sampleMemory("long-history-ready");
  console.log("STRESS_STAGE", "long-scroll");
  const scroll = page.locator(".chat-scrollbar");
  await scroll.evaluate(el => el.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true })));
  await scroll.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
  const first = page.getByText("Answer 0/0.", { exact: true });
  await first.scrollIntoViewIfNeeded();
  await expect(first).toBeInViewport();
  await first.evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.locator("[data-response-selection-toolbar]")).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Answer 0/0.");
  const mountedTurns = await page.locator("[data-turn-id]").count();
  expect(mountedTurns).toBeLessThan(50);
  const scrollFrames = await scroll.evaluate(async el => {
    const samples: number[] = [];
    for (let i = 0; i < 24; i++) {
      const at = performance.now();
      el.scrollTop = i % 2 ? 0 : el.scrollHeight;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      samples.push(performance.now() - at);
    }
    return samples;
  });
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
  await expect(page.getByText("Answer 0/499.", { exact: true })).toBeInViewport();
  await sampleMemory("long-scroll-done");
  console.log("STRESS_STAGE", "load-all-history");
  for (let s = 1; s < sessions; s++) await select(s);
  await sampleMemory("all-history-loaded");
  console.log("STRESS_STAGE", "warm-switches");
  // Warm switches exercise the accumulated store and the entire sidebar.
  for (let i = 0; i < 24; i++) await select(i % sessions);
  await sampleMemory("warm-switches");
  console.log("STRESS_STAGE", "streaming");
  streaming = true;
  for (let s = 0; s < sessions; s++) {
    await injectEvent(page, { type: "session.steering", session_id: `stress-${s}`, turn_id: `live-${s}`, text: `Stream concurrently ${s}`, outcome: "startedNewTurn", openma_event: {
      schema_version: "oma.event.v1", event_id: `live-prompt-${s}`, session_id: `stress-${s}`, turn_id: `live-${s}`, occurred_at: new Date(1793862000000 + s * 1000).toISOString(), source: { kind: "user" }, type: "user.message", data: { text: `Stream concurrently ${s}`, input_kind: "steering", outcome: "startedNewTurn" },
    } });
  }
  const burstStart = performance.now();
  // Multiple asynchronous producers share the real main-to-renderer IPC path.
  await Promise.all([
    ...Array.from({ length: 20 }, (_, s) => (async () => {
      for (let i = 0; i < 40; i++) {
        await injectEvent(page, { type: "session.event", session_id: `stress-${s}`, turn_id: `live-${s}`, event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `chunk ${i} ` } } });
        await new Promise(resolve => setTimeout(resolve, 8));
      }
    })()),
    (async () => { for (let i = 0; i < 12; i++) await select(i % sessions); })(),
  ]);
  const burstMs = performance.now() - burstStart;
  for (let s = 0; s < sessions; s++) await injectEvent(page, { type: "session.complete", session_id: `stress-${s}`, turn_id: `live-${s}` });
  await sampleMemory("after-burst");
  console.log("STRESS_STAGE", "settled-churn");
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 8; i++) await select(i % sessions);
    await page.waitForTimeout(500);
    await sampleMemory(`settled-churn-${round}`);
  }
  if (profiler) {
    const { profile } = await profiler.send("Profiler.stop");
    writeFileSync(`/tmp/backchat-renderer-${phase}.cpuprofile`, JSON.stringify(profile));
    await profiler.detach();
  }
  const metrics = await page.evaluate(() => (window as unknown as { stressMetrics: { history: { id: number; ms: number }[]; longTasks: number[]; skippedTurns: number } }).stressMetrics);
  expect(metrics.history.length).toBeGreaterThanOrEqual(60);
  // Current common virtualizes (the 2026-09 content-visibility audit predates it).
  await expect(page.locator("[data-virtual-transcript]")).toBeVisible();
  const result = { phase, revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), envelope: { sessions, turns, smallTurns, streamingSessions: 20, chunksPerSession: 40, scrollJumps: 24, warmSwitches: 24, burstSwitches: 12, workerCount: 1, tracing: false, cpuProfile: !!profiler, visible: true, display: "Xvfb 1280x1024x24, --disable-gpu", cache: "fresh Electron/temp DB, one reload, cold history followed by warm switches", command: `BACKCHAT_PERF_PHASE=${phase} BACKCHAT_E2E_VISIBLE=1 BACKCHAT_E2E_DISABLE_TRACING=1 xvfb-run -a node_modules/.bin/playwright test e2e/high-load-performance.spec.ts --workers=1`, versions: await app.evaluate(() => process.versions) }, scrollFrames, mountedTurns, burstMs, metrics, memory };
  mkdirSync("artifacts/perf-stress-20261105", { recursive: true });
  writeFileSync(`artifacts/perf-stress-20261105/electron-${phase}-${testInfo.repeatEachIndex}.json`, JSON.stringify(result, null, 2));
  await testInfo.attach("high-load-performance.json", { body: JSON.stringify(result), contentType: "application/json" });
  console.log("HIGH_LOAD_PERFORMANCE", JSON.stringify({ burstMs, history: metrics.history, scrollFrames, longTasks: metrics.longTasks, memory }));
});
