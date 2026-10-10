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
    await enableAgent(page, "codex-acp");
    await enableAgent(page, "claude-acp");
    await page.goto("/projects/workspace-fit-project");
    await page.getByRole("button", { name: /Set up coordinator|设置项目协调/ }).click();
    const combobox = page.getByRole("combobox", {
      name: /Coordinator agent|协调代理|Set-up coordinator/i,
    });
    await combobox.click();
    const panel = page.locator('[data-composer-select-menu-mode="grouped-command-field"]');
    await panel.locator('input[type="search"], input[cmdk-input]').fill("an");
    await expectNoRendererCrash(page);
  });
});
