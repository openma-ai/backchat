import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

test("injected image input shares prompt presentation without adding a turn", async ({ page, app, capture }) => {
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler("session:start"); ipcMain.handle("session:start", () => ({})); });
  const png = await app.evaluate(({ nativeImage }) => {
    return nativeImage.createFromBitmap(Buffer.alloc(64 * 64 * 4, 160), { width: 64, height: 64 }).toPNG().toString("base64");
  });
  const id = await injectSession(page, { sessionId: "steer-rich-input" });
  const image = { id: "image", name: "screen.png", kind: "image", mimeType: "image/png", path: "/tmp/screen.png", uri: "file:///tmp/screen.png", data: png };
  const original = { schema: "oma.event.v1", event_id: "original", session_id: id, turn_id: "active-turn", source: { kind: "user" }, occurred_at: "2026-10-23T05:00:00.000Z", type: "user.message", data: { text: "Original request", input_kind: "prompt", attachments: [image] } };
  await injectEvent(page, { type: "session.event", session_id: id, turn_id: "active-turn", event: original, openma_event: original });
  await injectEvent(page, { type: "session.queue_update", session_id: id, mode: "single", active_turn_id: "active-turn", queued: [] });
  const steer = { ...original, event_id: "steer", turn_id: "steer-turn", occurred_at: "2026-10-23T05:01:00.000Z", data: { text: "Look at this screenshot", input_kind: "steering", outcome: "injected", active_turn_id: "active-turn", attachments: [image] } };
  await injectEvent(page, { type: "session.steering", session_id: id, turn_id: "steer-turn", active_turn_id: "active-turn", effective_delivery: "llm_boundary", requested_delivery: "llm_boundary", outcome: "injected", text: "Look at this screenshot", openma_event: steer });
  const turn = page.locator('[data-turn-id="active-turn"]');
  await expect(turn.getByText("Look at this screenshot", { exact: true })).toBeVisible();
  await expect(turn.locator('[data-session-turn-prompt] img[alt="screen.png"]')).toHaveCount(1);
  await expect(turn.locator('[data-user-prompt-actions]')).toHaveCount(1);
  await expect(page.locator('[data-turn-id="steer-turn"]')).toHaveCount(0);
  await expect(turn.locator('[data-turn-timestamp="1792731660000"]')).toHaveCount(1);
  const preview = turn.locator('img[alt="screen.png"]');
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 64)).toBe(true);
  expect(await preview.evaluate(el => !!el.closest('[data-session-process-state]'))).toBe(false);
  await capture("steer-shared-image-message.png");
  const unavailable = { ...image, id: "missing", name: "missing.png", data: undefined, path: "/tmp/backchat-missing-preview-image.png", uri: "file:///tmp/backchat-missing-preview-image.png" };
  const missingSteer = { ...steer, event_id: "missing-image", turn_id: "missing-steer", data: { ...steer.data, text: "Missing preview", attachments: [unavailable] } };
  await injectEvent(page, { type: "session.steering", session_id: id, turn_id: "missing-steer", active_turn_id: "active-turn", effective_delivery: "llm_boundary", requested_delivery: "llm_boundary", outcome: "injected", text: "Missing preview", openma_event: missingSteer });
  await expect(turn.locator('a[download="missing.png"]')).toContainText("missing.png");
  await expect(turn.locator('img[alt="missing.png"]')).toHaveCount(0);
  await expect(page.locator('[data-turn-id="missing-steer"]')).toHaveCount(0);
});
