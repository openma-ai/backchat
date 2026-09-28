import { test, expect } from "./fixtures";
import { persistSessionFixture } from "./helpers";

test("removing a project preserves chats and stays removed after reload", async ({ page }) => {
  await page.evaluate(() => window.backchat.projectSave({ project_id: "remove-test", name: "Remove test", source_folders: ["/tmp/remove-project-test"], primary_folder: "/tmp/remove-project-test" }));
  await persistSessionFixture(page, { sessionId: "keep-chat", title: "Keep chat", agentId: "codex-acp", cwd: "/tmp/remove-project-test", acpSessionId: "", events: [{ type: "user_prompt", data: { text: "Keep me" } }] });
  await page.reload();
  const project = page.locator('[data-sidebar-project="project:remove-test"]');
  await expect(project).toBeVisible();
  const menu = page.locator('[data-sidebar-project="project:remove-test"]').getByRole("button", { name: "Project actions", exact: true });
  await menu.click();
  await page.getByRole("menuitem", { name: "Remove project", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("existing chats won't be deleted");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(project).toBeVisible();
  await menu.click();
  await page.getByRole("menuitem", { name: "Remove project", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove project", exact: true }).click();
  await expect(project).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Keep chat", exact: true })).toBeVisible();
  await page.reload();
  await expect(project).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Expand|Collapse) project: remove-project-test$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Keep chat", exact: true }).click();
  await expect(page.getByText("Keep me", { exact: true })).toBeVisible();
});

test("archive project chats asks first and retains the saved project", async ({ page }) => {
  await page.evaluate(() => window.backchat.projectSave({ project_id: "archive-test", name: "Archive test", source_folders: ["/tmp/archive-project-test"], primary_folder: "/tmp/archive-project-test" }));
  await persistSessionFixture(page, { sessionId: "archive-chat", title: "Archive chat", agentId: "codex-acp", cwd: "/tmp/archive-project-test", acpSessionId: "", events: [] });
  await page.reload();
  const project = page.locator('[data-sidebar-project="project:archive-test"]');
  await page.locator('[data-sidebar-project="project:archive-test"]').getByRole("button", { name: "Project actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Archive chats", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Archive 1 chats?");
  await dialog.getByRole("button", { name: "Archive all", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(project).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await window.backchat.sessionsList(50)).some(s => s.id === "archive-chat"))).toBe(false);
  await expect.poll(() => page.evaluate(async () => (await window.backchat.sessionsListArchived()).some(s => s.id === "archive-chat"))).toBe(true);
});
