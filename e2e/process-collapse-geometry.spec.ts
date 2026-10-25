import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

test("process collapse clips height without changing paragraph width or scaling text", async ({ page, app, capture }) => {
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler("session:start"); ipcMain.handle("session:start", () => ({})); });
  const id = await injectSession(page, { sessionId: "collapse-geometry" });
  const send = (event: Record<string, unknown>) => injectEvent(page, { type: "session.event", session_id: id, turn_id: "collapse-turn", event });
  await send({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "This is a long interim paragraph. ".repeat(24) }, _meta: { codex: { phase: "commentary" } } });
  await send({ sessionUpdate: "tool_call", toolCallId: "read", title: "Read file", kind: "read", status: "completed" });
  await send({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Completed answer" }, _meta: { codex: { phase: "final_answer" } } });
  await injectEvent(page, { type: "session.complete", session_id: id, turn_id: "collapse-turn", stop_reason: "end_turn" });
  const turn = page.locator('[data-turn-id="collapse-turn"]');
  const trigger = turn.locator('[data-session-process-state] > [data-chat-reasoning-trigger]');
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const process = turn.locator('[data-session-process-activity]');
  await expect(process).toBeVisible();
  await expect.poll(() => process.evaluate(el => el.getAnimations().length)).toBe(0);
  const before = await process.evaluate(el => {
    const text = el.querySelector("p")!;
    return { width: text.getBoundingClientRect().width, height: text.getBoundingClientRect().height };
  });
  await page.evaluate(() => document.documentElement.style.setProperty("--motion-disclosure-duration", "1000ms"));
  await process.evaluate(el => { void el.getBoundingClientRect().height; });
  await trigger.click();
  const middle = await process.evaluate(async el => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const clip = el.closest(".reasoning-collapse-inner")!;
    for (const animation of clip.getAnimations()) {
      animation.pause();
      animation.currentTime = 100;
    }
    const text = el.querySelector("p")!;
    return { width: text.getBoundingClientRect().width, height: text.getBoundingClientRect().height, transform: getComputedStyle(text).transform, shellHeight: el.getBoundingClientRect().height };
  });
  expect(middle.width).toBeCloseTo(before.width, 0);
  expect(middle.height).toBeCloseTo(before.height, 0);
  expect(middle.transform).toBe("none");
  await capture("process-collapse-intermediate.png");
  await process.evaluate(el => { for (const animation of el.closest(".reasoning-collapse-inner")!.getAnimations()) animation.finish(); });
  await expect.poll(() => turn.locator(".reasoning-collapse-inner").first().evaluate(el => el.getBoundingClientRect().height)).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.click();
  await expect(process).toBeVisible();
  await trigger.click();
  await expect.poll(() => turn.locator(".reasoning-collapse-inner").first().evaluate(el => el.getBoundingClientRect().height)).toBe(0);
});
