import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { enableAgent, injectEvent, injectSession, launchApp } from "./helpers";

const artifactDir = "/opt/cursor/artifacts/screenshots/model-picker-stable-height";

function groupedModelOptions() {
  const providers = ["anthropic-proxy", "openai-codex", "devin", "minimax-m31"];
  return providers.map((provider) => ({
    group: provider,
    name: provider,
    options: Array.from({ length: 5 }, (_, index) => ({
      value: `${provider}-${index}`,
      name: `${provider} model ${index}`,
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

test("model picker panel height stays fixed while filtering (screenshots)", async () => {
  test.setTimeout(180_000);
  await mkdir(artifactDir, { recursive: true });

  const queries = ["", "d", "de", "devin", "devin 2", "zzz"];

  for (const theme of ["light", "dark"] as const) {
    const { page, cleanup } = await launchApp({
      language: "en",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await setThemeMode(page, theme);
      await enableAgent(page, "codex-acp");
      const sessionId = await injectSession(page, { agentId: "codex-acp" });
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: "model-picker-stable-height",
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

      const runTrigger = page.getByRole("button", { name: /Run on/i }).first();
      await runTrigger.click();
      await page.getByRole("menuitem", { name: /^Model\b/ }).first().hover();
      const panel = page.getByTestId("composer-select-menu-panel");
      await expect(panel).toBeVisible({ timeout: 10_000 });

      const search = panel.locator('input[type="search"], input[cmdk-input]');
      const heights: number[] = [];

      for (let index = 0; index < queries.length; index++) {
        const query = queries[index];
        await search.fill(query);
        const box = await panel.boundingBox();
        expect(box).not.toBeNull();
        heights.push(box!.height);
        const slug = query.length === 0 ? "browse" : query.replace(/\s+/g, "-");
        await page.screenshot({
          path: join(artifactDir, `${theme}-query-${index}-${slug}.png`),
          animations: "disabled",
        });
      }

      const maxDelta = Math.max(...heights) - Math.min(...heights);
      expect(maxDelta).toBeLessThanOrEqual(2);
      expect(Math.max(...heights)).toBeLessThanOrEqual(420 + 2);
    } finally {
      await cleanup();
    }
  }
});
