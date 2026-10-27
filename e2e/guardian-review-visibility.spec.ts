import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

test("routine native reviews stay hidden without hiding failures or normal tools", async ({ page, app }) => {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("session:start");
    ipcMain.handle("session:start", () => ({}));
  });
  const id = await injectSession(page, { sessionId: "guardian-visibility", agentId: "codex-acp" });
  const send = (event: Record<string, unknown>) => injectEvent(page, {
    type: "session.event", session_id: id, turn_id: "review-turn", event,
  });
  const review = (status: string) => ({
    reviewId: "opaque", threadId: "thread", turnId: "turn",
    review: { status }, action: { type: "command" },
  });
  await send({ sessionUpdate: "tool_call", toolCallId: "opaque", title: "Internal safety assessment", kind: "think", status: "in_progress", rawInput: review("inProgress") });
  await injectEvent(page, { type: "session.queue_update", session_id: id, mode: "single", active_turn_id: "review-turn", queued: [] });
  const turn = page.locator('[data-turn-id="review-turn"]');
  await expect(turn.getByText("Internal safety assessment", { exact: true })).toHaveCount(0);
  await expect(turn.locator("[data-thinking-fallback]")).toHaveCount(1);
  await send({ sessionUpdate: "tool_call_update", toolCallId: "opaque", status: "completed", rawOutput: review("approved") });
  await expect(turn.getByText("Internal safety assessment", { exact: true })).toHaveCount(0);
  await send({ sessionUpdate: "tool_call_update", toolCallId: "opaque", status: "failed", rawOutput: review("denied") });
  await expect(turn.getByText("Internal safety assessment", { exact: true })).toBeVisible();
  await send({ sessionUpdate: "tool_call", toolCallId: "normal", title: "Guardian Review", kind: "execute", status: "in_progress" });
  await expect(turn.getByRole("button", { name: "Running Guardian Review", exact: true })).toBeVisible();
});
