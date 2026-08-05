import { expect, test } from "./fixtures";

test("scheduled tasks and settings share the application shell and page scrollbar", async ({
  page,
  capture,
}) => {
  await page.setViewportSize({ width: 1440, height: 640 });

  await page.getByRole("link", { name: "Scheduled", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Scheduled", exact: true })).toBeVisible();

  const shellSidebar = page.locator("aside").first();
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  const scheduledSidebarWidth = await shellSidebar.evaluate((element) =>
    element.getBoundingClientRect().width,
  );

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  const settingsSurface = page
    .getByRole("heading", { name: "Activity", exact: true })
    .locator("xpath=ancestor::*[contains(@class, 'overflow-y-auto')][1]");
  await expect(settingsSurface).toHaveClass(/app-scrollbar/);
  await expect.poll(() =>
    settingsSurface.evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
  const settingsSidebarWidth = await shellSidebar.evaluate((element) =>
    element.getBoundingClientRect().width,
  );

  expect(settingsSidebarWidth).toBeCloseTo(scheduledSidebarWidth, 1);

  const scrollbar = await settingsSurface.evaluate((element) => {
    const style = getComputedStyle(element, "::-webkit-scrollbar");
    const thumb = getComputedStyle(element, "::-webkit-scrollbar-thumb");
    return {
      width: style.width,
      thumbRadius: thumb.borderRadius,
      thumbBorder: thumb.borderTopWidth,
    };
  });
  expect(scrollbar.width).toBe("10px");
  expect(scrollbar.thumbRadius).toBe("9999px");
  // Electron reports borders after the app zoom factor is applied.
  expect(Number.parseFloat(scrollbar.thumbBorder)).toBeGreaterThan(2);

  await settingsSurface.evaluate((element) => element.scrollTo({ top: 48 }));
  await expect.poll(() =>
    settingsSurface.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  await capture("settings-shared-shell.png", "settings shared shell");
});
