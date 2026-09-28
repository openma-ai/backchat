import { test, expect } from "./fixtures";

test("project identity and approved icons agree across navigation and composer", async ({ page, home }, testInfo) => {
  await page.evaluate(async path => {
    await window.backchat.projectSave({ project_id: "shared-icon", name: "Unified project", source_folders: [path], primary_folder: path });
    localStorage.setItem("backchat.project-icon.v1:project:shared-icon", JSON.stringify({ kind: "icon", glyph: "terminal", color: "#2563eb" }));
  }, home);
  await page.reload();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const sidebar = page.locator('[data-sidebar-project="project:shared-icon"]');
  await expect(sidebar.locator('[data-project-glyph="terminal"]')).toBeVisible();
  const trigger = page.locator('[data-composer-footer-control="project"]');
  await trigger.click();
  const option = page.getByRole("option", { name: "Unified project", exact: true });
  await expect(option).toHaveCount(1);
  await expect(option.locator('[data-project-glyph="terminal"]')).toHaveCSS("color", "rgb(37, 99, 235)");
  await page.screenshot({ path: testInfo.outputPath("project-picker-light.png") });
  await option.click();
  await expect(trigger).toContainText("Unified project");
  await expect(trigger.locator('[data-project-glyph="terminal"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  await expect(page.locator('[cmdk-dialog], [role="dialog"]').last()).toBeVisible();
  await expect(page.locator('[role="dialog"] [data-backchat-icon="settings"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("command-palette-light.png") });
});


test("project menu uses the shared compact circular action highlight", async ({ page, home }, testInfo) => {
  await page.evaluate(async path => {
    await window.backchat.projectSave({ project_id: "row-highlight", name: "Highlight project", source_folders: [path], primary_folder: path });
  }, home);
  await page.reload();
  const row = page.locator('[data-sidebar-project="project:row-highlight"]');
  const surface = row.locator('.sidebar-project-surface');
  const trigger = row.locator('button[data-sidebar-row-action="true"]');
  await row.hover();
  await trigger.hover();
  await expect(trigger).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const dimensions = await trigger.evaluate(element => {
    const css = getComputedStyle(element);
    return { width: parseFloat(css.width), height: parseFloat(css.height), radius: parseFloat(css.borderRadius), token: parseFloat(css.getPropertyValue("--sidebar-row-action-size")) };
  });
  expect(dimensions.width).toBe(dimensions.token);
  expect(dimensions.height).toBe(dimensions.width);
  expect(dimensions.radius).toBe(dimensions.width / 2);
  await trigger.click();
  await expect(row).toHaveAttribute("data-menu-open", "true");
  await page.mouse.move(900, 400);
  await expect(trigger).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(surface).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath("project-menu-highlight.png") });
  await page.keyboard.press("Escape");
  await expect(row).not.toHaveAttribute("data-menu-open", "true");
  await expect(trigger).toBeFocused();
  await expect(surface).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});
