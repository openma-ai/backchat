import { expect, test } from "./fixtures";
import { fileURLToPath } from "node:url";
import { reloadRenderer, waitForRunnableHarness } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.evaluate(async ({ node, agent }) => {
    await window.backchat.settingsPatch({ agents: [{ id: "codex-acp", enabled: true, command_override: node, args_override: [agent], env: [] }] });
  }, { node: process.execPath, agent: fileURLToPath(new URL("./fixtures/fake-acp-agent.mjs", import.meta.url)) });
  await reloadRenderer(page);
  await waitForRunnableHarness(page);
});

test("project coordinator uses the ordinary chat surface", async ({ page }) => {
  await page.evaluate(async () => {
    await window.backchat.projectSave({
      project_id: "shared-chat-surface",
      name: "Shared chat surface",
      source_folders: [],
    });
    await window.backchat.projectWorkSave({
      projectId: "shared-chat-surface",
      description: "",
      instructions: "",
      context: "",
      resources: [],
      coordinatorAgent: "codex-acp",
      workerAgent: "codex-acp",
      continuity: "per-scope",
      controls: ["delegate", "steer", "cancel", "complete"],
      execution: { kind: "local" },
    });
  });
  await page.reload();
  const project = page.locator('[data-sidebar-project="project:shared-chat-surface"]');
  await project.getByRole("button", { name: "Expand project: Shared chat surface" }).click();
  await project.locator('[data-sidebar-grid="label"] button').click();
  await expect(page.locator('[data-chat-binding="coordinator"] [data-chat-surface="main"]')).toBeVisible();
  await expect(page.getByLabel("Message coordinator", { exact: true })).toBeVisible();
  await expect(page.locator('[data-chat-binding="coordinator"] [data-composer-submit="true"]')).toBeVisible();
});

test("unconfigured projects open directly in chat with an unlocked Run picker", async ({ page }) => {
  await page.evaluate(async () => {
    await window.backchat.projectSave({ project_id: "no-setup", name: "No setup", source_folders: [] });
  });
  await page.reload();
  const project = page.locator('[data-sidebar-project="project:no-setup"]');
  await project.getByRole("button", { name: "Expand project: No setup" }).click();
  await project.locator('[data-sidebar-grid="label"] button').click();
  await expect(page.getByLabel("Message coordinator", { exact: true })).toBeVisible();
  await expect(page.getByText("Make this project your own", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-chat-binding="coordinator"] [data-composer-submit="true"]')).toBeVisible();
});

test("first coordinator send uses the Run picker selection without a setup save", async ({ page }) => {
  await page.evaluate(async () => {
    await window.backchat.projectSave({ project_id: "first-run", name: "First run", source_folders: [] });
  });
  await page.reload();
  const project = page.locator('[data-sidebar-project="project:first-run"]');
  await project.getByRole("button", { name: "Expand project: First run" }).click();
  await project.locator('[data-sidebar-grid="label"] button').click();
  const chat = page.locator('[data-chat-binding="coordinator"]');
  await chat.locator('[data-composer-run-trigger="true"]').click();
  await expect(page.getByRole("menu").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByLabel("Message coordinator", { exact: true }).fill("First message without setup");
  await chat.locator('[data-composer-submit="true"]').click();
  await expect.poll(() => page.evaluate(async () => (await window.backchat.projectWorkView("first-run")).config)).toMatchObject({
    coordinatorAgent: "codex-acp", workerAgent: "codex-acp", controls: ["delegate", "steer", "cancel", "complete"],
  });
});
