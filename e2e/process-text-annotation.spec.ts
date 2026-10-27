import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

test("interim assistant text remains annotatable during a running turn", async ({ page, app, capture }) => {
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler("session:start"); ipcMain.handle("session:start", () => ({})); });
  const id = await injectSession(page, { sessionId: "annotate-interim" });
  await injectEvent(page, { type: "session.event", session_id: id, turn_id: "annotation-turn", event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Select this interim assistant paragraph for annotation." }, _meta: { codex: { phase: "commentary" } } } });
  await injectEvent(page, { type: "session.event", session_id: id, turn_id: "annotation-turn", event: { sessionUpdate: "tool_call", toolCallId: "running", title: "Read file", kind: "read", status: "in_progress" } });
  const paragraph = page.locator('[data-turn-id="annotation-turn"] .chat-markdown p').first();
  await expect(paragraph).toContainText("Select this interim");
  await paragraph.evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const toolbar = page.locator('[data-response-selection-toolbar]');
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Add to prompt", exact: true }).click();
  await expect(page.locator('[data-response-annotation-marker]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "1 annotation", exact: true })).toBeVisible();
  await capture("annotation-running-process-text.png");
});
