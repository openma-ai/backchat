import { expect, test } from "./fixtures";

test.describe("project creation", () => {
  test("creates a durable project container from the sidebar", async ({
    page,
    bridge,
    capture,
  }) => {
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.evaluate(async () => {
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        appearance: { ...current.appearance, theme: "dark" },
      });
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
    await page.getByRole("button", { name: "Create project", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create project" }),
    ).toBeVisible();
    await expect(dialog.getByText("Source folders", { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Add folders OpenMA can read and edit",
      }),
    ).toBeVisible();

    await dialog.getByRole("textbox", { name: "Project name" }).fill("OpenMA workspace");
    await bridge.setPickedDirs([
      "/Users/demo/OpenMA/app",
      "/Users/demo/OpenMA/docs",
      "/Users/demo/OpenMA/backend",
    ]);
    await dialog.getByRole("button", {
      name: "Add folders OpenMA can read and edit",
    }).click();
    await expect(dialog.getByText("app", { exact: true })).toBeVisible();
    await expect(dialog.getByText("docs", { exact: true })).toBeVisible();
    await expect(dialog.getByText("backend", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Make primary" }).first().click();
    await expect(dialog.getByText("Primary", { exact: true })).toBeVisible();
    await capture(
      "create-project-multi-root.png",
      "Create project multi-root dialog",
    );
    await dialog.getByRole("button", { name: "Create project" }).click();

    await expect(
      page.getByRole("button", { name: "OpenMA workspace", exact: true }),
    ).toBeVisible();
  });
});
