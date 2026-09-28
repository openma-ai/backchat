import { expect, test } from "./fixtures";

test("project coordinator uses the ordinary chat surface", async ({ page, capture }) => {
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
  await project.locator("..").getByRole("link").click();
  await expect(page.locator('[data-chat-surface="project"]')).toBeVisible();
  await expect(page.getByLabel("Message coordinator", { exact: true })).toBeVisible();
  await capture("project-coordinator-chat.png", "project coordinator chat");
});
