import { expect, test } from "./fixtures";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** Issue #68: every project creation path resolves an already-registered
 *  folder (by symlink, trailing slash or the folder itself) to one project,
 *  and the composer picker lists it once with a single highlighted row. */
test("every creation path reuses the project registered for a folder", async ({ page, app, home, bridge }) => {
  const repo = join(home, "hilo-coord-test");
  const link = join(home, "hilo-link");
  await mkdir(repo, { recursive: true });
  await symlink(repo, link);
  const pick = (path: string) => app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, path);
  const projects = () => page.evaluate(() => window.backchat.projectsList());

  const seeded = await page.evaluate((folder) => window.backchat.projectSave({
    project_id: "proj-seeded", name: "hilo-coord-test", source_folders: [folder], primary_folder: folder,
  }), repo);

  const createFromDialog = async (folder: string, name: string) => {
    await bridge.setPickedDirs([folder]);
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Project name", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Add folders OpenMA can read and edit", exact: true }).click();
    await dialog.getByRole("button", { name: "Create project", exact: true }).click();
    await expect(dialog).toBeHidden();
  };

  await createFromDialog(link, "hilo via symlink");
  await createFromDialog(`${repo}/`, "hilo via trailing slash");
  expect((await projects()).map((project) => project.id)).toEqual([seeded.id]);

  await page.reload();
  await pick(link);
  await openPicker(page);
  await page.getByRole("option", { name: "Browse…", exact: true }).click();
  expect((await projects()).map((project) => project.id)).toEqual([seeded.id]);

  const menu = await openPicker(page);
  await expect(menu.getByRole("option", { name: /hilo-coord-test/ })).toHaveCount(1);
  await expect(menu.locator('[cmdk-item][data-selected="true"]')).toHaveCount(1);
  const checked = menu.locator('[cmdk-item][data-checked="true"]');
  await expect(checked).toHaveCount(1);
  await expect(checked).toContainText("hilo-coord-test");
  await expect(checked.locator(".app-select-selected")).toBeVisible();
});

async function openPicker(page: Page) {
  await page.locator('[data-composer-footer-control="project"]').click();
  const menu = page.locator('[data-slot="command"]').filter({ has: page.getByPlaceholder("Choose project") });
  await expect(menu).toBeVisible();
  return menu;
}
