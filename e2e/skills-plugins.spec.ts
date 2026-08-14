import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { launchApp } from "./helpers";

test("configures global BackChat skills and plugins", async ({}, testInfo) => {
  const { page, cleanup } = await launchApp();
  try {
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("link", { name: "Skills & Plugins" }).click();

    await expect(page.getByRole("heading", { name: "Skills & Plugins" })).toBeVisible();
    await expect(page.getByText("BackChat built-ins")).toBeVisible();
    await expect(page.getByText("create-backchat-theme")).toBeVisible();
    await expect(page.getByText("No plugins are installed.")).toBeVisible();

    const schedulesSwitch = page.getByRole("switch").nth(1);
    await expect(schedulesSwitch).toHaveAccessibleName("Disable Scheduled tasks");
    await schedulesSwitch.click();
    await expect(schedulesSwitch).not.toBeChecked();
    await expect.poll(() => page.evaluate(async () =>
      (await window.backchat.settingsGet()).skills_plugins?.schedules_enabled,
    )).toBe(false);

    const screenshot = await page.screenshot({ fullPage: true });
    const screenshotPath = process.env["BACKCHAT_SKILLS_PLUGINS_SCREENSHOT"];
    if (screenshotPath) await writeFile(screenshotPath, screenshot);
    await testInfo.attach("Skills and Plugins settings", {
      body: screenshot,
      contentType: "image/png",
    });
  } finally {
    await cleanup();
  }
});
