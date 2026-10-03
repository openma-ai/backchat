import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

type ThemeMode = "light" | "dark";
type TurnPhase = "running" | "complete";

/** Resting process header row: full width, no bubble fill (openma-common v0.7.6+). */
const TRANSPARENT_IDLE = "rgba(0, 0, 0, 0)";

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

async function focusTriggerViaKeyboard(
  page: import("@playwright/test").Page,
  trigger: import("@playwright/test").Locator,
) {
  await page.mouse.move(0, 0);
  await trigger.scrollIntoViewIfNeeded();
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await trigger.evaluate((node) => node === document.activeElement);
    if (focused) return;
  }
  throw new Error("disclosure trigger did not receive keyboard focus");
}

async function expectTextLeftAlignedWithAssistantBody(
  turn: import("@playwright/test").Locator,
  trigger: import("@playwright/test").Locator,
) {
  const answerBody = turn.locator('[data-session-turn-answer="true"] .chat-markdown').first();
  await expect(answerBody).toBeVisible();
  const icon = trigger.locator(".chat-activity-icon").first();
  const summary = trigger.locator(".chat-transcript-disclosure-summary").first();
  const rowAnchor = (await icon.count()) > 0 ? icon : summary;
  const delta = await rowAnchor.evaluate((anchorEl) => {
    const firstGlyphLeftEdge = (target: Element) => {
      const range = document.createRange();
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent?.trim()) {
        node = walker.nextNode();
      }
      if (!node || !node.textContent?.trim()) {
        return target.getBoundingClientRect().left;
      }
      const trimOffset = node.textContent.length - node.textContent.trimStart().length;
      const end = Math.min(node.textContent.length, trimOffset + 1);
      range.setStart(node, trimOffset);
      range.setEnd(node, end);
      return range.getBoundingClientRect().left;
    };
    const answerEl = anchorEl
      .closest("[data-turn-id]")
      ?.querySelector('[data-session-turn-answer="true"] .chat-markdown');
    if (!answerEl) return Number.POSITIVE_INFINITY;
    const anchorEdge =
      anchorEl.classList.contains("chat-activity-icon")
        ? anchorEl.getBoundingClientRect().left
        : firstGlyphLeftEdge(anchorEl);
    return Math.abs(anchorEdge - firstGlyphLeftEdge(answerEl));
  });
  expect(delta).toBeLessThanOrEqual(1);
}

async function expectHoverDarkensTextWithoutBackground(
  page: import("@playwright/test").Page,
  trigger: import("@playwright/test").Locator,
) {
  const summary = trigger.locator(".chat-transcript-disclosure-summary").first();
  const restingColor = await summary.evaluate((el) => getComputedStyle(el).color);

  await page.mouse.move(0, 0);
  await expect(trigger).toHaveCSS("background-color", TRANSPARENT_IDLE);

  await hoverTrigger(page, trigger);
  await expect(trigger).toHaveCSS("background-color", TRANSPARENT_IDLE);
  const hoverColor = await summary.evaluate((el) => getComputedStyle(el).color);
  expect(hoverColor).not.toBe(restingColor);
}

async function seedCompleteExchange(
  page: import("@playwright/test").Page,
  sessionId: string,
  turnId: string,
  prompt: string,
  answer: string,
) {
  await injectEvent(page, {
    type: "session.prompt",
    session_id: sessionId,
    turn_id: turnId,
    text: prompt,
  });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: answer },
    },
  });
  await injectEvent(page, {
    type: "session.complete",
    session_id: sessionId,
    turn_id: turnId,
  });
}

async function seedTurn(
  page: import("@playwright/test").Page,
  sessionId: string,
  turnId: string,
  phase: TurnPhase,
  prompt = "appearance probe",
) {
  await injectEvent(page, {
    type: "session.prompt",
    session_id: sessionId,
    turn_id: turnId,
    text: prompt,
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

async function seedRichContextTurn(
  page: import("@playwright/test").Page,
  sessionId: string,
  turnId: string,
) {
  await injectEvent(page, {
    type: "session.prompt",
    session_id: sessionId,
    turn_id: turnId,
    text: "当前回合：请同时展示进程头与工具摘要行。",
  });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_thought_chunk",
      content: {
        type: "text",
        text: "先检查样式，再运行两条命令验证布局。",
      },
    },
  });
  for (const [index, command] of ["pnpm test", "pnpm lint"].entries()) {
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "tool_call",
        toolCallId: `rich-tool-${index}`,
        kind: "execute",
        status: "completed",
        title: command,
        rawInput: { command },
      },
    });
  }
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "两条命令都已完成。" },
    },
  });
  await injectEvent(page, {
    type: "session.complete",
    session_id: sessionId,
    turn_id: turnId,
  });
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

      await expectHoverDarkensTextWithoutBackground(page, trigger);

      if (phase === "complete") {
        await expectTextLeftAlignedWithAssistantBody(turn, trigger);
      }

      const turnWidth = (await turn.boundingBox())?.width ?? 0;
      const triggerWidth = (await trigger.boundingBox())?.width ?? 0;
      expect(triggerWidth).toBeGreaterThan(200);
      expect(triggerWidth).toBeGreaterThanOrEqual(turnWidth * 0.9);
    }
  }

  if (shotRoot) {
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      const contextSessionId = await injectSession(page, { agentId: "codex-acp" });
      await seedCompleteExchange(
        page,
        contextSessionId,
        `turn-before-${theme}`,
        "上一条用户消息：帮我总结昨天的会议。",
        "这是上一条助手回复，用于给进程行提供上下文。",
      );
      const focusTurnId = `turn-focus-${theme}`;
      await seedRichContextTurn(page, contextSessionId, focusTurnId);
      const focusTurn = page.locator(`[data-turn-id="${focusTurnId}"]`);
      const focusTrigger = focusTurn.locator('[data-chat-reasoning-trigger="true"]');
      const activityTrigger = focusTurn
        .locator('[data-chat-activity-disclosure-trigger="true"]')
        .filter({ hasText: "运行一些命令" });
      await expect(focusTurn).toBeVisible();
      await expect(focusTrigger).toContainText("已工作");
      await focusTurn.scrollIntoViewIfNeeded();
      await expectTextLeftAlignedWithAssistantBody(focusTurn, focusTrigger);
      await focusTrigger.click();
      await expect(focusTrigger).toHaveAttribute("aria-expanded", "true");
      await expect(activityTrigger).toBeVisible();
      await expectTextLeftAlignedWithAssistantBody(focusTurn, activityTrigger);
      await expectHoverDarkensTextWithoutBackground(page, activityTrigger);

      await page.mouse.move(0, 0);
      await page.screenshot({
        path: `${shotRoot}/window-${theme}-idle.png`,
        fullPage: false,
      });

      await hoverTrigger(page, focusTrigger);
      await page.screenshot({
        path: `${shotRoot}/window-${theme}-hover.png`,
        fullPage: false,
      });

      await page.mouse.move(0, 0);
      await activityTrigger.click();
      await expect(activityTrigger).toHaveAttribute("aria-expanded", "true");
      await page.mouse.move(0, 0);
      await expect(activityTrigger).toHaveCSS("background-color", TRANSPARENT_IDLE);
      await expect(activityTrigger).toHaveCSS("box-shadow", "none");
      await page.screenshot({
        path: `${shotRoot}/window-${theme}-expanded-blur.png`,
        fullPage: false,
      });

      await activityTrigger.click();
      await expect(activityTrigger).toHaveAttribute("aria-expanded", "false");
      await focusTriggerViaKeyboard(page, activityTrigger);
      const outlineWidth = await activityTrigger.evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).outlineWidth),
      );
      expect(outlineWidth).toBeGreaterThanOrEqual(1);
      await page.screenshot({
        path: `${shotRoot}/window-${theme}-focus-visible.png`,
        fullPage: false,
      });
      await page.keyboard.press("Enter");
      await expect(activityTrigger).toHaveAttribute("aria-expanded", "true");
    }
  }
});
