import { mkdir } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { launchApp } from "./helpers";

const artifactDir = "/opt/cursor/artifacts/screenshots";

const updateAgentFixture = {
  id: "codex-acp",
  label: "Codex",
  command: "codex-acp",
  detected: true,
  available: true,
  installed: true,
  installedVersion: "1.0.0",
  latestVersion: "2.0.0",
  updateAvailable: true,
};

test("capture sidebar footer settings row inset with update control", async () => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });

  const { page, cleanup } = await launchApp({
    language: "zh-CN",
    env: { BACKCHAT_E2E_VISIBLE: "1" },
  });
  try {
    await page.evaluate(async (fixture) => {
      await window.__backchatTest.setAgentSetupFixture({ agents: [fixture] });
      const settings = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        agents: [
          ...settings.agents.filter((agent) => agent.id !== fixture.id),
          { id: fixture.id, enabled: true, env: [] },
        ],
      });
    }, updateAgentFixture);
    await page.reload();
    await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });

    await page.getByRole("link", { name: "设置", exact: true }).click();
    await page.getByRole("link", { name: "智能体", exact: true }).click();
    await page.getByRole("button", { name: "返回应用", exact: true }).click();
    await expect(page.getByRole("button", { name: "有 1 个 ACP 更新可用" })).toBeVisible();

    const footer = page.locator('[data-sidebar-footer-actions="true"]');
    await footer.screenshot({
      path: `${artifactDir}/sidebar-footer-settings-inset-zh.png`,
    });
  } finally {
    await cleanup();
  }
});
