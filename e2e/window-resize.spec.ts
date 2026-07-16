import { expect, test } from "@playwright/test";
import { injectSession, launchApp } from "./helpers";

test("live window resize freezes the browser guest and simplifies panel compositing", async ({}, testInfo) => {
  const { app, page, cleanup } = await launchApp();
  try {
    await injectSession(page, {
      agentId: "codex-acp",
      cwd: "/tmp/backchat-resize-test",
    });
    const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
    if (!(await closeSidePanel.isVisible())) {
      await page.getByRole("button", { name: "Open side chat" }).click();
    }
    await expect(closeSidePanel).toBeVisible();
    await page.getByRole("button", { name: /浏览器/ }).click();

    const webview = page.locator("webview");
    await webview.waitFor();
    await expect(
      page.getByRole("button", { name: "Annotate page element" }),
    ).toBeEnabled();

    const rightRail = page
      .locator("aside.liquid-glass")
      .filter({ has: closeSidePanel });
    await expect(rightRail).toBeVisible();
    await expect
      .poll(() => page.locator("html").getAttribute("data-window-resizing"))
      .toBeNull();
    const restingBackground = await rightRail.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      const [width, height] = win.getSize();
      let step = 0;
      const timer = setInterval(() => {
        win.setSize(width + (step % 2 === 0 ? 48 : 0), height, false);
        step += 1;
        if (step >= 60) clearInterval(timer);
      }, 16);
    });

    await expect
      .poll(() => page.locator("html").getAttribute("data-window-resizing"))
      .toBe("true");
    await expect
      .poll(() =>
        rightRail.evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .not.toBe(restingBackground);
    const snapshot = page.locator("[data-browser-resize-snapshot]");
    await expect(snapshot).toBeVisible();
    await expect(webview).toHaveCSS("visibility", "hidden");

    const resizingPath = testInfo.outputPath("browser-window-resizing.png");
    await page.screenshot({ path: resizingPath });
    await testInfo.attach("browser window resizing", {
      path: resizingPath,
      contentType: "image/png",
    });

    await expect
      .poll(() => page.locator("html").getAttribute("data-window-resizing"))
      .toBeNull();
    await expect(snapshot).toHaveCount(0);
    await expect(webview).toHaveCSS("visibility", "visible");
    await expect
      .poll(() =>
        rightRail.evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .toBe(restingBackground);
  } finally {
    await cleanup();
  }
});
