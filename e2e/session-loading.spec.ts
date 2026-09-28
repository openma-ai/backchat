import { test, expect } from "./fixtures";
import { persistSessionFixture } from "./helpers";

for (const withHistory of [false, true]) {
test(`history=${withHistory}: switching to an unloaded session shows the startup animation until history arrives`, async ({ page, app }) => {
  await persistSessionFixture(page, {
    sessionId: "loading-check", agentId: "codex-acp", cwd: "", acpSessionId: "",
    title: "Loading target", events: [],
  });
  await app.evaluate(({ ipcMain }, populated) => {
    const gate = new Promise<void>(resolve => { (globalThis as unknown as { releaseHistory: () => void }).releaseHistory = resolve; });
    ipcMain.removeHandler("sessions:loadHistory");
    ipcMain.handle("sessions:loadHistory", async () => { await gate; return populated ? [
      { seq: 1, ts: Date.now(), type: "user_prompt", data: JSON.stringify({ text: "First screen prompt" }) },
      { seq: 2, ts: Date.now(), type: "agent_message_chunk", data: JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: Array.from({ length: 40 }, (_, index) => `Paragraph ${index}.`).join("\n\n") + "\n\nFirst screen ready." } }) },
    ] : []; });
  }, withHistory);
  await page.reload();
  await page.getByRole("button", { name: "Loading target", exact: true }).click();
  const loader = page.getByRole("status", { name: "Loading conversation…", exact: true });
  await expect(loader).toBeVisible();
  await expect(page.locator('[data-chat-history-loading="true"] textarea')).toHaveCount(0);
  await expect(page.locator('[data-chat-history-loading="true"] .composer-card')).toHaveCount(0);
  await expect(loader.locator(".openma-startup-loader-dot")).toHaveCount(3);
  await expect(loader).toHaveAttribute("viewBox", "240 244 548 454");
  await expect(page.getByRole("heading", { name: "Pick an agent" })).toHaveCount(0);
  await app.evaluate(() => (globalThis as unknown as { releaseHistory: () => void }).releaseHistory());
  await expect(loader).toBeHidden();
  if (withHistory) {
    await expect(page.getByText("First screen ready.", { exact: true })).toBeInViewport();
    await expect(page.locator('[data-chat-surface="main"] .composer-card')).toBeVisible();
  }
});

}
