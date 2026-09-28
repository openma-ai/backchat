import { test, expect } from "./fixtures";
import { persistSessionFixture } from "./helpers";

test("long history skips offscreen layout without dropping text selection or jump targets", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    (window as unknown as { skippedTurns: number }).skippedTurns = 0;
    document.addEventListener("contentvisibilityautostatechange", event => {
      if ((event as Event & { skipped: boolean }).skipped) (window as unknown as { skippedTurns: number }).skippedTurns++;
    }, true);
  });
  await persistSessionFixture(page, { sessionId: "long-layout", title: "Long layout", agentId: "codex-acp", cwd: "", acpSessionId: "", events: Array.from({ length: 120 }, (_, i) => [
    { type: "user_prompt", data: { text: `Question ${i}` } },
    { type: "agent_message_chunk", data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Answer ${i}.\n\n` + "Paragraph with **formatting** and `code`.\n\n".repeat(8) } } },
  ]).flat() });
  await page.reload();
  await page.getByRole("button", { name: "Long layout", exact: true }).click();
  await expect(page.locator('[data-chat-history-loading="true"]')).toHaveCount(0);
  await expect(page.getByText("Answer 119.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { skippedTurns: number }).skippedTurns)).toBeGreaterThan(0);
  const scroll = page.locator(".chat-scrollbar");
  await scroll.evaluate(el => el.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true })));
  const first = page.getByText("Answer 0.", { exact: true });
  // Programmatic find/jump must unlock the target even far outside the viewport.
  await first.scrollIntoViewIfNeeded();
  await expect(first).toBeInViewport();
  await first.evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.locator('[data-response-selection-toolbar]')).toBeVisible();
  const frameTimes = await scroll.evaluate(async el => {
    const samples: number[] = [];
    for (let i = 0; i < 24; i++) {
      const start = performance.now();
      el.scrollTop = i % 2 ? 0 : el.scrollHeight;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      samples.push(performance.now() - start);
    }
    return samples;
  });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Answer 0.");
  await first.scrollIntoViewIfNeeded();
  await expect(first).toBeInViewport();
  await expect(page.getByText("Answer 119.", { exact: true })).toHaveCount(1);
  await testInfo.attach("long-transcript-frames.json", { body: JSON.stringify(frameTimes), contentType: "application/json" });
});
