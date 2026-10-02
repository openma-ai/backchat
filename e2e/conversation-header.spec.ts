import { test, expect } from "./fixtures";
import { persistSessionFixture } from "./helpers";

async function appRegion(locator: { evaluate: (fn: (el: Element) => string) => Promise<string> }) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return style.getPropertyValue("-webkit-app-region").trim()
      || style.getPropertyValue("app-region").trim();
  });
}

test("top chrome stays draggable without duplicating the sidebar new chat action", async ({ page }) => {
  const header = page.locator('[data-window-titlebar="true"]');
  await expect(header).toBeVisible();
  expect(await appRegion(header)).toBe("drag");
  await persistSessionFixture(page, { sessionId: "header-chat", title: "Header chat", agentId: "codex-acp", cwd: "", acpSessionId: "", events: [
    { type: "user_prompt", data: { text: "Keep this conversation" } },
    { type: "agent_message_chunk", data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Existing answer." } } },
  ] });
  await page.reload();
  await page.getByRole("button", { name: "Header chat", exact: true }).click();
  await expect(page.getByText("Existing answer.", { exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "New chat", exact: true })).toHaveCount(0);
  expect(await appRegion(header)).toBe("drag");
  const title = header.getByText("Header chat", { exact: true });
  await expect(title).toBeVisible();
  expect(await appRegion(title)).toBe("drag");
  // The title sits in a grouping wrapper that used to be no-drag. Blink
  // excludes that whole subtree, so the wrapper itself has to be drag.
  expect(await appRegion(title.locator("xpath=.."))).toBe("drag");
  const taskActions = header.getByRole("button", { name: "Task actions", exact: true });
  expect(await appRegion(taskActions)).toBe("no-drag");
  await taskActions.click();
  await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const navigation = page.getByRole("navigation");
  const createConversation = navigation.getByRole("button", { name: "New conversation", exact: true });
  await navigation.getByRole("button", { name: "Chats", exact: true }).hover();
  await expect(createConversation).toBeVisible();
  expect(await appRegion(createConversation)).toBe("no-drag");
  await createConversation.click();
  await expect(page.getByTestId("new-chat-button")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".composer-card").first()).toBeVisible();
  await expect(page.getByText("Existing answer.", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(header).toBeVisible();
  expect(await appRegion(header)).toBe("drag");
});
