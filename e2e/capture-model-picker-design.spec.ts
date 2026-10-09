import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { enableAgent, injectEvent, injectSession, launchApp } from "./helpers";

const artifactDir = "/opt/cursor/artifacts/screenshots/model-picker-design";

function groupedModelOptions() {
  const providers = ["anthropic-proxy", "openai-codex", "devin", "minimax-m31"];
  return providers.map((provider) => ({
    group: provider,
    name: provider,
    options: Array.from({ length: 5 }, (_, index) => ({
      value: `${provider}-${index}`,
      name: `${provider} model ${index}`,
      ...(provider === "devin" && index === 2
        ? { description: "Custom endpoint" }
        : {}),
    })),
  }));
}

async function setThemeMode(
  page: import("@playwright/test").Page,
  theme: "light" | "dark",
) {
  await page.evaluate(async (next) => {
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      appearance: { ...current.appearance, theme: next, language: "en" },
    });
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", theme);
}

async function seedModelConfig(page: import("@playwright/test").Page) {
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "model-picker-design",
    event: {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "openai-codex-2",
          options: groupedModelOptions(),
        },
      ],
    },
  });
}

test("capture model picker design states (light + dark)", async () => {
  test.setTimeout(180_000);
  await mkdir(artifactDir, { recursive: true });

  for (const theme of ["light", "dark"] as const) {
    const { page, cleanup } = await launchApp({
      language: "en",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await setThemeMode(page, theme);
      await seedModelConfig(page);

      const runTrigger = page.getByRole("button", { name: /Run on/i }).first();
      await expect(runTrigger).toBeVisible();
      await page.screenshot({
        path: join(artifactDir, `${theme}-01-closed-pill.png`),
        animations: "disabled",
      });

      await runTrigger.click();
      await page.getByRole("menuitem", { name: /^Model\b/ }).first().hover();
      const panel = page.getByTestId("composer-select-menu-panel");
      await expect(panel).toBeVisible({ timeout: 10_000 });
      await page.screenshot({
        path: join(artifactDir, `${theme}-02-level1-providers.png`),
        animations: "disabled",
      });

      const search = panel.getByRole("searchbox");
      await search.press("ArrowDown");
      await search.press("ArrowRight");
      await expect(panel.getByTestId("composer-model-pane")).toContainText("devin model");
      await page.screenshot({
        path: join(artifactDir, `${theme}-03-level2-models.png`),
        animations: "disabled",
      });

      await search.fill("minimax 1");
      await expect(panel.getByRole("listbox", { name: "Options" })).toContainText(
        "minimax-m31 model 1",
      );
      await page.screenshot({
        path: join(artifactDir, `${theme}-04-search-results.png`),
        animations: "disabled",
      });

      await search.fill("zzznomatchxyz");
      await expect(panel.getByText("No matching options.")).toBeVisible();
      await page.screenshot({
        path: join(artifactDir, `${theme}-05-empty-search.png`),
        animations: "disabled",
      });
    } finally {
      await cleanup();
    }
  }
});
