/**
 * PR56 item 1 only — model submenu bottom align + search-shrink evidence.
 * Outputs to PR56_ITEM_DIR/{before|after}/ and compare/ when stitched locally.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { enableAgent, injectEvent, injectSession, launchApp } from "./helpers";

const VIEWPORT = { width: 1400, height: 900 };
const root = process.env.PR56_ITEM_DIR ?? "/opt/cursor/artifacts/pr56-item-01";

function shot(phase: "before" | "after", name: string) {
  return join(root, phase, name);
}

function groupedModelOptions(count: number) {
  const providers = ["anthropic-proxy", "openai-codex", "devin", "minimax-m31"];
  return providers.flatMap((provider) =>
    Array.from({ length: Math.ceil(count / providers.length) }, (_, index) => ({
      value: `${provider}-${index}`,
      name: `${provider} model ${index}`,
      group: provider,
    })),
  );
}

async function seedModelSession(page: import("@playwright/test").Page) {
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "item-01-model",
    event: {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "openai-codex-2",
          options: groupedModelOptions(24),
        },
      ],
    },
  });
}

test.describe("PR56 item 01 submenu", () => {
  const phase = (process.env.PR56_ITEM_PHASE ?? "after") as "before" | "after";

  test.beforeAll(async () => {
    await mkdir(join(root, phase), { recursive: true });
  });

  test("full model submenu bottom aligned with primary menu", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await enableAgent(page, "codex-acp");
      await seedModelSession(page);
      await page.locator('[data-composer-run-trigger="true"]').click();
      const primary = page.locator('[data-slot="dropdown-menu-content"]').last();
      await expect(primary).toBeVisible();
      await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
      const subPanel = page.getByTestId("composer-select-menu-panel");
      if (phase === "after") {
        await expect(subPanel).toBeVisible({ timeout: 10_000 });
      } else {
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(250);
      await page.screenshot({
        path: shot(phase, "01-submenu-full.png"),
        fullPage: false,
      });
    } finally {
      await cleanup();
    }
  });

  test("filtered model submenu stays aligned and shrinks", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await enableAgent(page, "codex-acp");
      await seedModelSession(page);
      await page.locator('[data-composer-run-trigger="true"]').click();
      await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
      const subPanel = page.getByTestId("composer-select-menu-panel");
      if (phase === "after") {
        await expect(subPanel).toBeVisible({ timeout: 10_000 });
        const search = subPanel.locator('input[type="search"], input[cmdk-input]');
        await search.fill("minimax-m31 model 0");
      } else {
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(300);
      await page.screenshot({
        path: shot(phase, "01-submenu-search-short.png"),
        fullPage: false,
      });
    } finally {
      await cleanup();
    }
  });
});
