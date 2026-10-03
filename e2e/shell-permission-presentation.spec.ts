import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { injectEvent, injectSession, launchApp } from "./helpers";

const denyCommand = "echo PR28R2-REJECT-ME > pr28r2-shell-reject.txt";
const longCommand =
  "echo PR28R2-LONG-FAIL this command is long enough that the tool row must truncate it before the status label instead of letting the label drift into the middle of the line";

async function trailingPlacement(row: import("@playwright/test").Locator) {
  return row.evaluate((root) => {
    const badge = root.querySelector("[data-tool-status-label]");
    const line = root.querySelector(".activity-disclosure-row");
    const chevron = line?.querySelector(".activity-disclosure-chevron");
    const command = line?.querySelector("[data-tool-activity-identity] .truncate");
    if (
      !(badge instanceof HTMLElement)
      || !(line instanceof HTMLElement)
      || !(chevron instanceof HTMLElement)
      || !(command instanceof HTMLElement)
    ) {
      return null;
    }
    const badgeBox = badge.getBoundingClientRect();
    const lineBox = line.getBoundingClientRect();
    const chevronBox = chevron.getBoundingClientRect();
    const commandBox = command.getBoundingClientRect();
    return {
      commandToBadge: badgeBox.left - commandBox.right,
      badgeToChevron: chevronBox.left - badgeBox.right,
      chevronToEnd: lineBox.right - chevronBox.right,
      overlaps: commandBox.right > badgeBox.left + 1,
      truncated: command.scrollWidth > command.clientWidth + 1,
    };
  });
}

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

    await send("turn-long", {
      sessionUpdate: "tool_call",
      toolCallId: "shell-long",
      kind: "execute",
      status: "failed",
      title: longCommand,
      rawOutput: "exit 1",
    });
    await send("turn-long", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "LONG" },
    });
    await injectEvent(page, {
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-long",
    });

    const triggers = page.locator('[data-chat-reasoning-trigger="true"]');
    await expect(triggers).toHaveCount(3);
    for (const trigger of await triggers.all()) {
      if ((await trigger.getAttribute("aria-expanded")) !== "true") {
        await trigger.click();
      }
    }

    const denyTurn = page.locator('[data-turn-id="turn-deny"]');
    const failTurn = page.locator('[data-turn-id="turn-fail"]');
    const longTurn = page.locator('[data-turn-id="turn-long"]');
    await expect(denyTurn.getByText("REJECTED")).toBeVisible();

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(720, 640);
    });

    const worked = longTurn.locator('[data-chat-reasoning-trigger="true"]');
    await expect(worked).toBeVisible();

    const applyTheme = async (theme: "light" | "dark") => {
      await page.evaluate(async (next) => {
        const current = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          appearance: { ...current.appearance, theme: next, language: "zh-CN" },
        });
      }, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme-mode", theme);
      await page.mouse.move(0, 0);
      await expect(worked).toHaveCSS(
        "background-color",
        theme === "light" ? "rgb(233, 233, 233)" : "rgb(64, 64, 64)",
      );
    };

    await applyTheme("light");
    if (shotDir) {
      await page.screenshot({ path: `${shotDir}/narrow-light.png` });
      await longTurn.screenshot({ path: `${shotDir}/long-failed-light.png` });
    }
    await applyTheme("dark");
    if (shotDir) {
      await page.screenshot({ path: `${shotDir}/narrow-dark.png` });
      await longTurn.screenshot({ path: `${shotDir}/long-failed-dark.png` });
    }

    const failed = failTurn.locator('[data-tool-call-id="shell-fail"]');
    await expect(failed).toBeVisible();
    const placement = await trailingPlacement(failed);
    expect(placement).not.toBeNull();
    expect(placement!.overlaps).toBe(false);
    expect(placement!.commandToBadge).toBeGreaterThanOrEqual(-1);
    expect(placement!.commandToBadge).toBeLessThan(24);
    expect(placement!.badgeToChevron).toBeGreaterThanOrEqual(-1);
    expect(placement!.badgeToChevron).toBeLessThan(12);
    expect(placement!.chevronToEnd).toBeLessThan(8);
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

    const longFailed = longTurn.locator('[data-tool-call-id="shell-long"]');
    await expect(longFailed).toBeVisible();
    const longPlacement = await trailingPlacement(longFailed);
    expect(longPlacement).not.toBeNull();
    expect(longPlacement!.truncated).toBe(true);
    expect(longPlacement!.overlaps).toBe(false);
    expect(longPlacement!.badgeToChevron).toBeGreaterThanOrEqual(-1);
    expect(longPlacement!.badgeToChevron).toBeLessThan(12);
    expect(longPlacement!.chevronToEnd).toBeLessThan(8);
  } finally {
    await launched.cleanup();
  }
});
