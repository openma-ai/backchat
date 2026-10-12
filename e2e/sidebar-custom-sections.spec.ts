import { expect, test } from "./fixtures";
import { persistSessionFixture, reloadRenderer } from "./helpers";

test("organizes a chat in a custom section across reload and restores it when removed", async ({ page }) => {
  await persistSessionFixture(page, {
    sessionId: "section-chat",
    title: "Section chat",
    cwd: "",
    events: [],
  });
  await reloadRenderer(page);

  await page.getByRole("button", { name: "Sidebar options" }).click();
  await page.getByRole("menuitem", { name: "New section" }).click();
  const create = page.getByRole("dialog", { name: "New section" });
  await create.getByRole("textbox", { name: "Section name" }).fill("Work");
  await create.getByRole("button", { name: "Create" }).click();

  const chat = page.getByRole("button", { name: "Section chat", exact: true });
  await chat.hover();
  await chat
    .locator("xpath=ancestor::div[contains(@class,'sidebar-grid-row')]")
    .getByRole("button", { name: "Session actions" })
    .click();
  await page.getByRole("menuitem", { name: "Move to section" }).hover();
  await page.getByRole("menuitem", { name: "Work", exact: true }).click();

  const section = page.locator("[data-sidebar-custom-section]");
  await expect(section.getByRole("button", { name: "Section chat", exact: true })).toBeVisible();
  await reloadRenderer(page);
  await expect(section.getByRole("button", { name: "Section chat", exact: true })).toBeVisible();

  await section.getByRole("button", { name: "Section actions" }).click();
  await page.getByRole("menuitem", { name: "Rename section" }).click();
  const rename = page.getByRole("dialog", { name: "Rename section" });
  await rename.getByRole("textbox", { name: "Section name" }).fill("Research");
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(section.getByRole("button", { name: "Research", exact: true })).toBeVisible();

  await section.getByRole("button", { name: "Section actions" }).click();
  await page.getByRole("menuitem", { name: "Delete section" }).click();
  const remove = page.getByRole("dialog", { name: "Delete section" });
  await remove.getByRole("button", { name: "Delete section" }).click();
  await expect(section).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Section chat", exact: true })).toBeVisible();
});
