import { test, expect } from "./fixtures";
import { persistSessionFixture } from "./helpers";

test("top chrome stays draggable without duplicating the sidebar new chat action", async ({ page }) => {
  const header = page.locator("header").first();
  await expect(header).toBeVisible();
  expect(await header.evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region"))).toBe("drag");
  await persistSessionFixture(page, { sessionId: "header-chat", title: "Header chat", agentId: "codex-acp", cwd: "", acpSessionId: "", events: [
    { type: "user_prompt", data: { text: "Keep this conversation" } },
    { type: "agent_message_chunk", data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Existing answer." } } },
  ] });
  await page.reload();
  await page.getByRole("button", { name: "Header chat", exact: true }).click();
  await expect(page.getByText("Existing answer.", { exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "New chat", exact: true })).toHaveCount(0);
  expect(await header.evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region"))).toBe("drag");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(header).toBeVisible();
  expect(await header.evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region"))).toBe("drag");
});
