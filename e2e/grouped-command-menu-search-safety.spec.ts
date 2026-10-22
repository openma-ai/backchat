import { expect, test } from "./fixtures";
import {
  enableAgent,
  injectEvent,
  injectSession,
} from "./helpers";
import { seedWorkspacePickerFixture } from "./grouped-command-menu-fit.shared";

async function expectNoRendererCrash(page: import("@playwright/test").Page) {
  await expect(page.locator('[data-backchat-crash-mark="true"]')).toHaveCount(0);
}

test.describe("searchable grouped command menus do not crash the renderer", () => {
  test("project picker tolerates search input", async ({ page }) => {
    await enableAgent(page, "codex-acp");
    await page.getByTestId("new-chat-button").click();
    await page.locator('[data-composer-footer-control="project"]').click();
    const panel = page.getByTestId("composer-project-picker-panel");
    await panel.locator('input[type="search"], input[cmdk-input]').fill("re");
    await expectNoRendererCrash(page);
    await expect(panel).toBeVisible();
  });

  test("workspace picker tolerates feat search", async ({ page, home }) => {
    test.setTimeout(120_000);
    await seedWorkspacePickerFixture(page, home);
    await enableAgent(page, "codex-acp");
    await page.getByTestId("new-chat-button").click();
    await page.locator('[data-composer-footer-control="project"]').click();
    await page.getByRole("option", { name: "Workspace fit", exact: true }).click();
    await page.locator('[data-composer-footer-control="workspace"]').click();
    const panel = page.getByTestId("composer-workspace-picker-panel");
    await panel.locator('input[type="search"], input[cmdk-input]').fill("feat");
    await expectNoRendererCrash(page);
    await expect(panel).toBeVisible();
  });

  test("model picker tolerates provider search", async ({ page }) => {
    await enableAgent(page, "codex-acp");
    const sessionId = await injectSession(page, { agentId: "codex-acp" });
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "search-safety-model",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "devin-1",
            options: [
              {
                group: "devin",
                name: "devin",
                options: [{ value: "devin-1", name: "devin model 1" }],
              },
            ],
          },
        ],
      },
    });
    await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
    await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
    const panel = page.getByTestId("composer-select-menu-panel");
    await panel.locator('input[type="search"], input[cmdk-input]').fill("devin");
    await expectNoRendererCrash(page);
    await expect(panel).toBeVisible();
  });

  test("grouped command field tolerates agent search", async ({ page, home }) => {
    test.setTimeout(120_000);
    await seedWorkspacePickerFixture(page, home);
    await page.evaluate(async (command) => {
      const settings = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        agents: [
          ...settings.agents,
          ...Array.from({ length: 8 }, (_, index) => ({
            id: `grouped-search-agent-${index}`,
            label_override: `Grouped search agent ${index}`,
            command_override: command,
            args_override: [],
            env: [],
            enabled: true,
          })),
        ],
      });
    }, process.execPath);
    await page.reload();
    const projects = page.getByRole("button", { name: "Projects", exact: true });
    if (await projects.getAttribute("aria-expanded") === "false") await projects.click();
    const project = page.locator('[data-sidebar-project="project:workspace-fit-project"]');
    const toggle = project.locator("button[aria-expanded]").first();
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
    await page.locator('[data-project-coordinator="project:workspace-fit-project"]').click();
    await page.getByRole("button", { name: /Set up coordinator|设置项目协调/ }).click();
    await page.getByRole("button", { name: /Configure|配置/ }).click();
    const dialog = page.getByRole("dialog", { name: "Coordinator settings", exact: true });
    await dialog.getByRole("tab", { name: "Agents", exact: true }).click();
    const combobox = dialog.getByRole("combobox", { name: "Coordinator agent", exact: true });
    await combobox.click();
    const panel = page.locator('[data-composer-select-menu-mode="grouped-command-field"]');
    await panel.locator('input[type="search"], input[cmdk-input]').fill("an");
    await expectNoRendererCrash(page);
  });
});
