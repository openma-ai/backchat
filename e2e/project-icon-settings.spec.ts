import { test, expect } from "./fixtures";

test("project settings persist icon, color and name without coordinator setup", async ({ page, home }, testInfo) => {
  await page.evaluate(async path => {
    await window.backchat.projectSave({ project_id: "icon-project", name: "Icon project", source_folders: [path], primary_folder: path });
  }, home);
  await page.reload();
  const projectsToggle = page.getByRole("button", { name: "Projects", exact: true });
  if (await projectsToggle.count() === 1) {
    await expect(projectsToggle.locator("svg[data-backchat-icon]").first()).toHaveAttribute("stroke-width", "1.75");
  }
  const projectRow = page.locator('[data-sidebar-project="project:icon-project"]');
  await projectRow.hover();
  await projectRow.getByRole("button", { name: "Project actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Project settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Project settings", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("project-settings.png") });
  await page.getByRole("button", { name: "Set project icon", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("icon-picker.png") });
  await page.getByRole("button", { name: "terminal · 终端", exact: true }).click();
  await page.getByRole("textbox", { name: "HEX", exact: true }).fill("#ff0080");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill("Renamed icon project");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Renamed icon project");
  await page.reload();
  const row = page.locator('[data-sidebar-project="project:icon-project"]');
  await expect(row.locator('svg[data-project-glyph="terminal"]')).toBeVisible();
  await expect(row.locator('svg[data-project-glyph="terminal"]')).toHaveCSS("color", "rgb(255, 0, 128)");
  await row.hover();
  await row.getByRole("button", { name: "Project actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Set project icon", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Project settings", exact: true }).click();
  await page.getByRole("button", { name: "Set project icon", exact: true }).click();
  await page.getByRole("tab", { name: "Emoji", exact: true }).click();
  await page.getByRole("button", { name: "🦊", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await expect(row).toContainText("🦊");
  await row.hover();
  await row.getByRole("button", { name: "Project actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Set project icon", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Project settings", exact: true }).click();
  await page.getByRole("button", { name: "Set project icon", exact: true }).click();
  await page.getByRole("button", { name: "Use automatic icon", exact: true }).click();
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await expect(row).not.toContainText("🦊");
});
