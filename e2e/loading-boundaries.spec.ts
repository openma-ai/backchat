import { test, expect } from "./fixtures";
import { persistSessionFixture } from "./helpers";

test("every settings panel loads inside the persistent settings shell", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  for (const route of ["activity", "agents", "appearance", "mcp-servers", "browser", "archive", "about", "openma"]) {
    await page.locator(`a[href="/settings/${route}"]`).click();
    await expect(page.getByRole("button", { name: "Back to app", exact: true })).toBeVisible();
    await expect(page.locator("main h1")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("settings opens its shell and skeleton while activity data is pending", async ({ page, app }) => {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("activity:stats");
    ipcMain.handle("activity:stats", () => new Promise(() => {}));
  });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to app", exact: true })).toBeVisible();
  await expect(page.locator('[data-settings-loading="true"]:visible')).toBeVisible();
  await expect(page.locator('[data-settings-loading="true"]:visible [data-slot="skeleton"]').first()).toBeVisible();
});

test("history boundary shows loading and preserves the latest viewport when prepending", async ({ page, app }) => {
  await persistSessionFixture(page, { sessionId: "boundary", title: "Boundary", agentId: "codex-acp", cwd: "", acpSessionId: "", events: [] });
  await app.evaluate(({ ipcMain }) => {
    const gate = new Promise<void>(resolve => { (globalThis as unknown as { releasePage: () => void }).releasePage = resolve; });
    ipcMain.removeHandler("sessions:loadHistory");
    ipcMain.handle("sessions:loadHistory", async (_event, _id, options) => {
      if (options?.before_seq) {
        await gate;
        return [{ seq: 1, ts: 1, type: "user_prompt", data: JSON.stringify({ text: "Original prompt" }) }, { seq: 2, ts: 2, type: "agent_message_chunk", data: JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Older paragraph.\n\n".repeat(30) } }) }];
      }
      return Array.from({ length: 800 }, (_, i) => ({ seq: 801 + i, ts: i + 2, type: "agent_message_chunk", data: JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Recent ${i}.\n\n` } }) }));
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Boundary", exact: true }).click();
  await expect(page.locator('[data-chat-history-loading="true"]')).toHaveCount(0);
  const scroll = page.locator('.chat-scrollbar');
  // Wait for the initial viewport to settle before emulating upward scrolling.
  await page.waitForTimeout(1600);
  await scroll.evaluate(el => { el.scrollTop = 200; });
  const loading = page.getByRole('status', { name: 'Loading earlier messages…', exact: true });
  await expect(loading).toBeVisible();
  expect((await loading.boundingBox())!.height).toBeGreaterThan(20);
  await scroll.evaluate(el => { el.scrollTop = 0; });
  const first = page.getByText('Recent 0.', { exact: true });
  const before = (await first.boundingBox())!.y;
  await app.evaluate(() => (globalThis as unknown as { releasePage: () => void }).releasePage());
  await expect(loading).toBeHidden();
  expect(Math.abs((await first.boundingBox())!.y - before)).toBeLessThan(5);
});
