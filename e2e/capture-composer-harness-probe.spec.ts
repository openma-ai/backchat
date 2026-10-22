import { mkdir } from "node:fs/promises";
import { test } from "./fixtures";
import { launchApp } from "./helpers";

const artifactDir = "/opt/cursor/artifacts/screenshots";

const codexFixture = {
  id: "codex-acp",
  label: "Codex",
  command: "codex-acp",
  detected: true,
  available: true,
  installed: true,
};

async function seedCodexHarness(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async (fixture) => {
    await window.__backchatTest.setAgentSetupFixture({ agents: [fixture] });
    const settings = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      agents: [
        ...settings.agents.filter((agent) => agent.id !== fixture.id),
        { id: fixture.id, enabled: true, env: [] },
      ],
    });
  }, codexFixture);
  await page.reload();
  await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });
}

test("capture composer harness probe loading", async () => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });

  const capture = async (filename: string, language: "en" | "zh-CN") => {
    const { page, cleanup } = await launchApp({
      language,
      env: {
        BACKCHAT_E2E_VISIBLE: "1",
        BACKCHAT_E2E_SKIP_LIVE_HARNESS_PROBE: "0",
        BACKCHAT_TEST_SLOW_LIVE_PROBE_MS: "15000",
      },
    });
    try {
      await seedCodexHarness(page);
      await page.waitForSelector(
        'textarea[data-composer-harness-probe="true"], [data-composer-harness-probe="true"]',
        { timeout: 35_000 },
      );
      await page.waitForTimeout(400);
      const composer = page.locator(".composer-stack-card").first();
      await composer.screenshot({
        path: `${artifactDir}/${filename}`,
      });
    } finally {
      await cleanup();
    }
  };

  await capture("composer-harness-probe-loading-en.png", "en");
  await capture("composer-harness-probe-loading-zh.png", "zh-CN");
});
