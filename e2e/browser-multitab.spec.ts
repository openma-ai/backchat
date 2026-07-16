import { expect, test, type Page } from "@playwright/test";

import { injectSession, launchApp } from "./helpers";

async function browserTool<T>(
  page: Page,
  taskId: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return page.evaluate(
    ({ taskId, name, args }) =>
      // @ts-expect-error -- test-only preload bridge
      window.__backchatTest.browserTool({ taskId, name, args }),
    { taskId, name, args },
  );
}

async function executeGuest<T>(root: ReturnType<Page["locator"]>, code: string): Promise<T> {
  return root.locator("webview").evaluate(
    (element, source) =>
      (element as HTMLElement & {
        executeJavaScript<TResult>(script: string): Promise<TResult>;
      }).executeJavaScript<T>(source),
    code,
  );
}

async function guestId(root: ReturnType<Page["locator"]>): Promise<number> {
  return root.locator("webview").evaluate((element) =>
    (element as HTMLElement & { getWebContentsId(): number }).getWebContentsId(),
  );
}

test("each task owns a persistent multi-tab in-app browser window", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const { page, cleanup } = await launchApp();
  try {
    const taskA = await injectSession(page, {
      agentId: "codex-acp",
      cwd: "/tmp/backchat-browser-window-a",
    });
    const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
    if (!(await closeSidePanel.isVisible())) {
      await page.getByRole("button", { name: "Open side chat" }).click();
    }
    await page.getByRole("button", { name: /浏览器/ }).click();

    const taskARoots = page.locator(`[data-browser-task="${taskA}"]`);
    await expect(taskARoots).toHaveCount(1);
    const firstRoot = taskARoots.nth(0);
    await expect(firstRoot).toHaveAttribute("data-browser-visible", "true");
    await expect.poll(() => browserTool(page, taskA, "browser_tabs", { action: "list" })).toMatchObject({
      tabs: [expect.objectContaining({ active: true })],
    });
    await browserTool(page, taskA, "browser_navigate", { url: "about:blank" });
    await executeGuest(firstRoot, `(() => {
      document.title = 'First workspace';
      document.body.innerHTML = '<main><h1>First tab</h1><input id="draft" value="alpha"><button id="increment">Increment</button></main>';
      window.__clicks = 0;
      document.querySelector('#increment').addEventListener('click', () => { window.__clicks += 1; });
      Object.assign(document.body.style, { margin: '0', padding: '32px', fontFamily: 'sans-serif', background: '#f5f7fb' });
    })()`);
    await expect(page.locator('button[title="First workspace"]')).toBeVisible();
    const firstGuestId = await guestId(firstRoot);

    const opened = await browserTool<{
      active_tab_id: string;
      tabs: Array<{ tab_id: string; active: boolean }>;
    }>(page, taskA, "browser_tabs", { action: "new", url: "about:blank" });
    expect(opened.tabs).toHaveLength(2);
    await expect(taskARoots).toHaveCount(2);
    const secondRoot = taskARoots.nth(1);
    await expect(secondRoot).toHaveAttribute("data-browser-visible", "true");
    await executeGuest(secondRoot, `(() => {
      document.title = 'Second workspace';
      const favicon = document.createElement('link');
      favicon.rel = 'icon';
      favicon.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="%236361f2"/><path d="M4 8h8M8 4v8" stroke="white" stroke-width="2"/></svg>';
      document.head.append(favicon);
      document.body.innerHTML = '<main><h1>Second tab</h1><input id="draft" value="beta"></main>';
      Object.assign(document.body.style, { margin: '0', padding: '32px', fontFamily: 'sans-serif', background: '#fff8ee' });
    })()`);
    const secondTabChip = page.locator('button[title="Second workspace"]');
    await expect(secondTabChip).toBeVisible();
    await expect(secondTabChip.locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml/);
    const secondGuestId = await guestId(secondRoot);
    expect(secondGuestId).not.toBe(firstGuestId);

    const firstTabId = opened.tabs.find((tab) => !tab.active)!.tab_id;
    await page.locator('button[title="First workspace"]').click();
    await expect(firstRoot).toHaveAttribute("data-browser-visible", "true");
    await expect.poll(() => browserTool(page, taskA, "browser_tabs", { action: "list" })).toMatchObject({
      active_tab_id: firstTabId,
    });
    expect(await guestId(firstRoot)).toBe(firstGuestId);
    await expect(executeGuest(firstRoot, `document.querySelector('#draft').value`)).resolves.toBe("alpha");
    await expect(browserTool(page, taskA, "browser_get_text")).resolves.toContain("First tab");
    await browserTool(page, taskA, "browser_click", { selector: "#increment" });
    await expect(executeGuest(firstRoot, `window.__clicks`)).resolves.toBe(1);
    const screenshot = await browserTool<{ data: string }>(
      page,
      taskA,
      "browser_screenshot",
    );
    expect(screenshot.data.length).toBeGreaterThan(100);

    await browserTool(page, taskA, "browser_tabs", {
      action: "select",
      tab_id: opened.active_tab_id,
    });
    await expect(secondRoot).toHaveAttribute("data-browser-visible", "true");

    const taskB = await injectSession(page, {
      agentId: "codex-acp",
      cwd: "/tmp/backchat-browser-window-b",
    });
    await page.getByRole("button", { name: /浏览器/ }).click();
    const taskBRoot = page.locator(`[data-browser-task="${taskB}"]`);
    await expect(taskBRoot).toHaveCount(1);
    await browserTool(page, taskB, "browser_navigate", { url: "about:blank" });
    await executeGuest(taskBRoot, `(() => {
      document.title = 'Task B browser';
      document.body.innerHTML = '<main><h1>Task B only</h1></main>';
      Object.assign(document.body.style, { margin: '0', padding: '32px', fontFamily: 'sans-serif', background: '#eefbf4' });
    })()`);

    await expect(page.locator("webview")).toHaveCount(3);
    expect(await guestId(firstRoot)).toBe(firstGuestId);
    expect(await guestId(secondRoot)).toBe(secondGuestId);
    await expect(browserTool(page, taskA, "browser_tabs", { action: "list" })).resolves.toMatchObject({
      tabs: [{}, {}],
    });
    await expect(browserTool(page, taskB, "browser_tabs", { action: "list" })).resolves.toMatchObject({
      tabs: [{}],
    });

    await page.getByRole("button", {
      name: `codex-acp · ${taskA.slice(0, 6)}`,
    }).click();
    await expect(secondRoot).toHaveAttribute("data-browser-visible", "true");
    await expect(executeGuest(secondRoot, `document.querySelector('#draft').value`)).resolves.toBe("beta");

    const screenshotPath = testInfo.outputPath("task-browser-multitab.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("task-scoped multi-tab browser", {
      path: screenshotPath,
      contentType: "image/png",
    });
  } finally {
    await cleanup();
  }
});
