import { expect, test } from "./fixtures";
import { enableAgent, injectSession, openBrowserPanel } from "./helpers";

test("live window resize freezes the browser guest and simplifies panel compositing", async ({ app, page, capture }) => {
    await enableAgent(page, "codex-acp");
    await injectSession(page, {
      agentId: "codex-acp",
      cwd: "/tmp/backchat-resize-test",
    });
    const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
    await openBrowserPanel(page);

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
    const snapshot = page.locator("[data-browser-resize-snapshot]");
    await expect(snapshot).toBeVisible();
    await expect(webview).toHaveCSS("visibility", "hidden");

    await capture("browser-window-resizing.png", "browser window resizing");

    await expect
      .poll(() => page.locator("html").getAttribute("data-window-resizing"))
      .toBeNull();
    await expect(snapshot).toHaveCount(0);
    await expect(webview).toHaveCSS("visibility", "visible");
});
