import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { injectEvent, injectSession, launchApp } from "./helpers";

const denyCommand = "echo PR28R2-REJECT-ME > pr28r2-shell-reject.txt";

test("shows a denied shell as not run, and keeps a real failure at the end of the row", async () => {
  const shotDir = process.env.BACKCHAT_SHELL_SHOT_DIR;
  if (shotDir) await mkdir(shotDir, { recursive: true });
  const launched = await launchApp({
    language: "zh-CN",
    env: { BACKCHAT_E2E_VISIBLE: "1" },
  });
  const { app, page } = launched;
  try {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 860);
    });
    const sessionId = await injectSession(page, {
      sessionId: "shell-gui-e2e",
      agentId: "codex-acp",
      cwd: "/tmp/backchat-shell-gui",
    });
    const send = (turnId: string, event: Record<string, unknown>) =>
      injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event,
      });

    await send("turn-deny", {
      schema: "oma.event.v1",
      schema_version: "oma.event.v1",
      event_id: "tool-denied",
      type: "tool.failed",
      session_id: sessionId,
      turn_id: "turn-deny",
      data: {
        tool_call_id: "shell-deny",
        title: denyCommand,
        kind: "execute",
        status: "failed",
        outcome: "denied",
        reason: "denied",
      },
    });
    await send("turn-deny", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "REJECTED" },
    });
    await injectEvent(page, {
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-deny",
    });

    await send("turn-fail", {
      sessionUpdate: "tool_call",
      toolCallId: "shell-fail",
      kind: "execute",
      status: "failed",
      title: "echo PR28R2-FAIL",
      rawOutput: "exit 1",
    });
    await send("turn-fail", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "FAILED" },
    });
    await injectEvent(page, {
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-fail",
    });

    const triggers = page.locator('[data-chat-reasoning-trigger="true"]');
    await expect(triggers).toHaveCount(2);
    for (const trigger of await triggers.all()) {
      if ((await trigger.getAttribute("aria-expanded")) !== "true") {
        await trigger.click();
      }
    }

    const denyTurn = page.locator('[data-turn-id="turn-deny"]');
    const failTurn = page.locator('[data-turn-id="turn-fail"]');
    await expect(denyTurn.getByText("REJECTED")).toBeVisible();

    if (shotDir) {
      await page.screenshot({ path: `${shotDir}/shell-turns.png` });
      await denyTurn.screenshot({ path: `${shotDir}/denied-shell.png` });
      await failTurn.screenshot({ path: `${shotDir}/failed-shell.png` });
    }

    const failed = failTurn.locator('[data-tool-call-id="shell-fail"]');
    await expect(failed).toBeVisible();
    const placement = await failed.evaluate((row) => {
      const badge = row.querySelector("[data-tool-status-label]");
      const line = row.querySelector(".activity-disclosure-row");
      const chevron = line?.querySelector(".activity-disclosure-chevron");
      if (!(badge instanceof HTMLElement) || !(line instanceof HTMLElement) || !(chevron instanceof HTMLElement)) {
        return null;
      }
      const badgeBox = badge.getBoundingClientRect();
      const lineBox = line.getBoundingClientRect();
      const chevronBox = chevron.getBoundingClientRect();
      return {
        badgeToChevron: chevronBox.left - badgeBox.right,
        chevronToEnd: lineBox.right - chevronBox.right,
      };
    });
    expect(placement).not.toBeNull();
    expect(placement!.badgeToChevron).toBeLessThan(16);
    expect(placement!.chevronToEnd).toBeLessThan(12);
    await expect(failed).toContainText("Failed");
    await expect(failed.locator(".text-danger")).not.toHaveCount(0);

    const denied = denyTurn.locator('[data-tool-call-id="shell-deny"]');
    await expect(denied).toBeVisible();
    await expect(denied).toHaveAttribute("data-tool-status", "denied");
    await expect(denied).toContainText("未运行");
    await expect(denied).toContainText("已拒绝");
    await expect(denied).toContainText(denyCommand);
    await expect(denied).not.toContainText("已运行");
    await expect(denied).not.toContainText("Failed");
    await expect(denied.locator(".text-danger")).toHaveCount(0);
  } finally {
    await launched.cleanup();
  }
});
