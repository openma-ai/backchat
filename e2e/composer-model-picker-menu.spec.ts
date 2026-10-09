import { expect, test } from "./fixtures";
import { enableAgent, injectEvent, injectSession } from "./helpers";

function manyGroupedModels() {
  const providers = ["anthropic-proxy", "openai-codex", "devin"];
  return providers.map((provider) => ({
    group: provider,
    name: provider,
    options: Array.from({ length: 4 }, (_, index) => ({
      value: `${provider}-${index}`,
      name: `${provider} model ${index}`,
    })),
  }));
}

function modelPickerPanel(page: import("@playwright/test").Page) {
  return page.getByTestId("composer-select-menu-panel");
}

test("model picker search filters by provider and model name", async ({ page, bridge }) => {
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "model-picker-filter",
    event: {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "anthropic-proxy-1",
          options: manyGroupedModels(),
        },
      ],
    },
  });

  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
  const panel = modelPickerPanel(page);
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const search = panel.getByRole("searchbox");
  await expect(search).toBeFocused();
  await search.fill("devin 1");
  await expect(panel.getByRole("listbox", { name: "Options" })).toContainText("devin model 1");
  await expect(panel.getByText("anthropic-proxy model 1")).toHaveCount(0);
});

test("model picker opens provider submenu with bounded scroll", async ({ page, bridge }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "model-picker-providers",
    event: {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "openai-codex-2",
          options: manyGroupedModels(),
        },
      ],
    },
  });

  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
  const panel = modelPickerPanel(page);
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const openaiProvider = panel.locator('[data-composer-provider-sub="true"]').filter({
    hasText: "openai-codex",
  });
  await expect(openaiProvider).toBeVisible();
  await expect(openaiProvider).toContainText("openai-codex model 2");

  await expect(panel.locator('[data-composer-provider-sub="true"]')).toHaveCount(3);

  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.height).toBeLessThanOrEqual(420 + 2);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
});
