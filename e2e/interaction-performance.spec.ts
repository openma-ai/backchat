import { test, expect } from "./fixtures";
import { injectEvent, injectSession, persistSessionFixture } from "./helpers";

// Diagnostic timings, not a machine-specific speed gate. Keep animations on:
// reload removes the fixture's animation-disabling stylesheet.
test("measure renderer navigation and input responsiveness", async ({ page }, testInfo) => {
  await persistSessionFixture(page, { sessionId: "perf-history", agentId: "codex-acp", cwd: "", acpSessionId: "", title: "Performance history", events: [
    { type: "user_prompt", data: { text: "Review this history" } },
    { type: "agent_message_chunk", data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "A rendered paragraph with **formatting**.\n\n".repeat(200) + "History ready." } } },
  ] });
  await page.addInitScript(() => {
    const metrics = { startup: 0, settings: [] as number[], history: [] as number[], input: [] as number[], longTasks: [] as number[] };
    (window as unknown as { perfMetrics: typeof metrics }).perfMetrics = metrics;
    let target: "settings" | "history" | null = null;
    let start = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) metrics.longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
    document.addEventListener("pointerdown", event => {
      const element = (event.target as Element).closest("a,button");
      if (element?.textContent?.trim() === "Settings") target = "settings";
      else if ((element?.getAttribute("aria-label") ?? element?.textContent ?? "").includes("Performance history")) target = "history";
      else return;
      start = event.timeStamp;
    }, true);
    document.addEventListener("input", event => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      requestAnimationFrame(() => metrics.input.push(performance.now() - event.timeStamp));
    }, true);
    new MutationObserver(() => {
      if (!metrics.startup && document.querySelector('[data-testid="new-chat-button"]') && document.querySelector(".composer-card")) {
        metrics.startup = -1;
        requestAnimationFrame(() => { metrics.startup = performance.now(); });
      }
      const ready = target === "settings"
        ? document.querySelector('[aria-label="Back to app"]')
        : target === "history" && !document.querySelector('[data-chat-history-loading="true"]') && document.querySelector(".chat-scrollbar")?.textContent?.includes("History ready.");
      if (ready && target) {
        const key = target, at = start;
        target = null;
        requestAnimationFrame(() => metrics[key].push(performance.now() - at));
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-chat-history-loading"] });
  });
  const runs = [];
  for (let run = 0; run < 3; run++) {
    await page.reload();
    await expect(page.locator(".composer-card")).toBeVisible();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to app", exact: true }).click();
    await page.getByRole("button", { name: "Performance history", exact: true }).click();
    await expect(page.getByText("History ready.", { exact: true })).toBeInViewport();
    await expect(page.locator('[data-chat-history-loading="true"]')).toHaveCount(0);
    const id = await injectSession(page, { agentId: "codex-acp", cwd: "" });
    await injectEvent(page, { type: "session.prompt", session_id: id, turn_id: `perf-${run}`, text: "Stream" });
    await injectEvent(page, { type: "session.event", session_id: id, turn_id: `perf-${run}`, event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Streaming started.\n\n" } } });
    await expect(page.getByText("Streaming started.", { exact: true })).toBeVisible();
    await expect(page.locator('[data-chat-history-loading="true"]')).toHaveCount(0);
    const input = page.locator("textarea").last();
    await expect(input).toHaveValue("");
    await expect(input).toBeEditable();
    await input.click();
    await Promise.all([
      page.keyboard.type("Typing while the answer streams should stay responsive. ".repeat(2), { delay: 8 }),
      (async () => {
        for (let i = 0; i < 60; i++) {
          await injectEvent(page, { type: "session.event", session_id: id, turn_id: `perf-${run}`, event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Paragraph ${i}: **useful content** and a [link](https://example.com).\n\n` } } });
          await new Promise(resolve => setTimeout(resolve, 16));
        }
      })(),
    ]);
    await expect(input).toHaveValue("Typing while the answer streams should stay responsive. ".repeat(2));
    const sample = await page.evaluate(() => (window as unknown as { perfMetrics: {
      startup: number; settings: number[]; history: number[]; input: number[]; longTasks: number[];
    } }).perfMetrics);
    expect(sample.startup).toBeGreaterThan(0);
    expect(sample.settings).toHaveLength(1);
    expect(sample.history).toHaveLength(1);
    expect(sample.input).toHaveLength(112);
    runs.push(sample);
  }
  console.log("INTERACTION_PERFORMANCE", JSON.stringify(runs));
  await testInfo.attach("renderer-performance.json", { body: JSON.stringify(runs, null, 2), contentType: "application/json" });
});
