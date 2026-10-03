import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

type ThemeMode = "light" | "dark";
type TurnPhase = "running" | "complete";

/** Resting process header row: full width, no bubble fill (openma-common v0.7.6+). */
const TRANSPARENT_IDLE = "rgba(0, 0, 0, 0)";

const HOVER_WASH: Record<ThemeMode, string> = {
  light: "color(srgb 0.0784314 0.0784314 0.0784314 / 0.08)",
  dark: "color(srgb 0.921569 0.913725 0.882353 / 0.08)",
};

async function setTheme(page: import("@playwright/test").Page, theme: ThemeMode) {
  await page.evaluate(async (next) => {
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      appearance: { ...current.appearance, theme: next, language: "zh-CN" },
    });
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", theme);
}

async function hoverTrigger(
  page: import("@playwright/test").Page,
  trigger: import("@playwright/test").Locator,
) {
  const box = await trigger.boundingBox();
  if (!box) throw new Error("reasoning trigger is not visible");
  await page.mouse.move(0, 0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function seedTurn(
  page: import("@playwright/test").Page,
  sessionId: string,
  turnId: string,
  phase: TurnPhase,
) {
  await injectEvent(page, {
    type: "session.prompt",
    session_id: sessionId,
    turn_id: turnId,
    text: "appearance probe",
  });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Inspecting styles for the process header." },
    },
  });
  if (phase === "complete") {
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Done." },
      },
    });
    await injectEvent(page, {
      type: "session.complete",
      session_id: sessionId,
      turn_id: turnId,
    });
  }
}

test("chat reasoning trigger uses plain full-width row styling", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 860 });
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const shotRoot = process.env.BACKCHAT_REASONING_TRIGGER_SHOT_DIR;

  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    for (const phase of ["running", "complete"] as const) {
      const turnId = `turn-reasoning-${theme}-${phase}`;
      await seedTurn(page, sessionId, turnId, phase);
      const turn = page.locator(`[data-turn-id="${turnId}"]`);
      const trigger = turn.locator('[data-chat-reasoning-trigger="true"]');
      await expect(trigger).toBeVisible();
      if (phase === "running") {
        await expect(trigger).toBeDisabled();
      }

      await page.mouse.move(0, 0);
      await expect(trigger).toHaveCSS("background-color", TRANSPARENT_IDLE);

      await hoverTrigger(page, trigger);
      await expect(trigger).toHaveCSS("background-color", HOVER_WASH[theme]);

      const turnWidth = (await turn.boundingBox())?.width ?? 0;
      const triggerWidth = (await trigger.boundingBox())?.width ?? 0;
      expect(triggerWidth).toBeGreaterThan(200);
      expect(triggerWidth).toBeGreaterThanOrEqual(turnWidth * 0.9);

      if (shotRoot) {
        await page.mouse.move(0, 0);
        const name = `${theme}-${phase}`;
        await trigger.screenshot({ path: `${shotRoot}/${name}-idle.png` });
        await hoverTrigger(page, trigger);
        await trigger.screenshot({ path: `${shotRoot}/${name}-hover.png` });
      }
    }
  }
});
