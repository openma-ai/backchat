import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

test("GUI shows structured live goal snapshots independently of turn completion", async ({ page, app, capture }) => {
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler("session:start"); ipcMain.handle("session:start", () => ({})); });
  const id = await injectSession(page, { sessionId: "goal-snapshot", agentId: "codex-acp" });
  const goal = { objective: "Verify the structured goal", status: "active", createdAt: Date.now() / 1000, tokensUsed: 500, timeUsedSeconds: 10, controlMethod: "_session/goal" };
  const send = (value: typeof goal | null) => injectEvent(page, { type: "session.event", session_id: id, event: { sessionUpdate: "session_info_update", _meta: { goal: value } } });
  await send(goal);
  await expect(page.locator('[data-goal-status="active"]')).toBeVisible();
  await capture("goal-structured-snapshot.png");
  await send({ ...goal, status: "paused" });
  await expect(page.locator('[data-goal-status="paused"]')).toBeVisible();
  await send({ ...goal, status: "complete" });
  await expect(page.locator('[data-goal-status]')).toHaveCount(0);
});
