import { expect, test } from "./fixtures";
import { enableAgent, injectEvent, injectSession } from "./helpers";

test("capture crash fallback screenshot", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, {
    sessionId: "ui-crash-demo",
    agentId: "codex-acp",
    cwd: "/tmp/ui-crash-demo",
  });
  const turnId = "turn-crash-demo";
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Working…" },
    },
  });
  await injectEvent(page, {
    type: "session.queue_update",
    session_id: sessionId,
    mode: "single",
    active_turn_id: turnId,
    queued: [],
  });
  await injectEvent(page, {
    type: "session.error",
    session_id: sessionId,
    message: "The agent connection was lost. You can edit your message and try again.",
  });
  await expect(
    page.locator('[data-slot="status-notice"][data-tone="danger"]').filter({
      hasText: "The agent connection was lost",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/backchat-crash-fallback.png",
  });
});
