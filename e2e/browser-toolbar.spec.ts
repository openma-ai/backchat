import { expect, test } from "@playwright/test";

import { injectSession, launchApp, openBrowserPanel } from "./helpers";

test("browser chrome is compact and exposes real page controls", async ({}, testInfo) => {
  const { page, cleanup } = await launchApp();
  try {
    const taskId = await injectSession(page, {
      agentId: "codex-acp",
      cwd: "/tmp/backchat-browser-toolbar",
    });
    await openBrowserPanel(page);

    const browser = page.locator(`[data-browser-task="${taskId}"]`);
    const tab = page.locator('button[title="New tab"]').first();
    const back = browser.getByRole("button", { name: "Back" });
    await expect(browser).toBeVisible();
    await expect(tab).toBeVisible();
    await expect(
      browser.locator('input[placeholder="Enter URL or search"]'),
    ).toHaveValue("about:blank#backchat-e2e");
    await expect(back).toBeVisible();

    const [tabBox, backBox] = await Promise.all([tab.boundingBox(), back.boundingBox()]);
    expect(tabBox).not.toBeNull();
    expect(backBox).not.toBeNull();
    expect(backBox!.y - (tabBox!.y + tabBox!.height)).toBeLessThanOrEqual(12);

    await expect(
      browser.getByRole("button", { name: "Open in default browser" }),
    ).toBeVisible();
    await expect(
      browser.getByRole("button", { name: "Annotate page element" }),
    ).toBeVisible();

    await browser.getByRole("button", { name: "Browser menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Find in page" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Print" })).toBeVisible();
    await expect(page.getByText("Zoom", { exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Show device toolbar" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Capture screenshot" })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Import cookies and passwords…" }),
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Passwords and autofill" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Downloads" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Clear browsing data" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Browser settings" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Capture screenshot" })).toBeEnabled();

    const beforeZoom = await browser.locator("webview").evaluate((element) =>
      (element as HTMLElement & { getZoomFactor(): number }).getZoomFactor(),
    );
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => browser.locator("webview").evaluate((element) =>
      (element as HTMLElement & { getZoomFactor(): number }).getZoomFactor(),
    )).toBeGreaterThan(beforeZoom);

    const menuScreenshot = testInfo.outputPath("browser-toolbar-menu.png");
    await page.screenshot({ path: menuScreenshot });
    await testInfo.attach("browser toolbar menu", {
      path: menuScreenshot,
      contentType: "image/png",
    });

    await page.getByRole("menuitem", { name: "Capture screenshot" }).click();
    await expect(page.getByText("Screenshot saved")).toBeVisible();

    await browser.getByRole("button", { name: "Browser menu" }).click();
    await page.getByRole("menuitem", { name: "Find in page" }).click();
    const findInput = browser.getByPlaceholder("Find in page");
    await expect(findInput).toBeVisible();
    await findInput.fill("backchat");
    await page.keyboard.press("Escape");
    await expect(findInput).toBeHidden();

    await browser.getByRole("button", { name: "Browser menu" }).click();
    await page.getByRole("menuitem", { name: "Passwords and autofill" }).click();
    await expect(page.getByRole("dialog", { name: "Passwords and autofill" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();

    await browser.getByRole("button", { name: "Browser menu" }).click();
    await page.getByRole("menuitem", { name: "Downloads" }).click();
    await expect(page.getByRole("dialog", { name: "Downloads" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();

    await browser.getByRole("button", { name: "Browser menu" }).click();
    await page.getByRole("menuitem", { name: "Clear browsing data" }).click();
    const clearDataDialog = page.getByRole("dialog", { name: "Clear browsing data" });
    const clearDataButton = clearDataDialog.getByRole("button", { name: "Clear data" });
    const history = clearDataDialog.getByRole("checkbox", { name: "Browsing history" });
    const cookies = clearDataDialog.getByRole("checkbox", { name: "Cookies and site data" });
    const cache = clearDataDialog.getByRole("checkbox", { name: "Cached images and files" });
    await expect(clearDataDialog).toBeVisible();
    await expect(history).toBeChecked();
    await expect(cookies).toBeChecked();
    await expect(cache).toBeChecked();

    await history.click();
    await cookies.click();
    await cache.click();
    await expect(clearDataButton).toBeDisabled();

    await history.click();
    await expect(clearDataButton).toBeEnabled();
    await clearDataButton.click();
    await expect(page.getByText("Browsing data cleared")).toBeVisible();
    await expect(clearDataDialog).toBeHidden();

    await browser.getByRole("button", { name: "Browser menu" }).click();
    await page.getByRole("menuitem", { name: "Browser settings" }).click();
    await expect(page.getByRole("heading", { name: "Browser" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Enable built-in browser" })).toBeVisible();
  } finally {
    await cleanup();
  }
});
