import { test, expect } from "./fixtures";
import { enableAgent, persistSessionFixture } from "./helpers";

test("task rail collects review links, persists manual associations and switches open tabs", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 2200, height: 900 });
  await enableAgent(page, "codex-acp");
  await persistSessionFixture(page, { sessionId: "resource-task", title: "Resource task", agentId: "codex-acp", cwd: "", acpSessionId: "", events: [
    { type: "user_prompt", data: { text: "Review this change" } },
    { type: "agent_message_chunk", data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "[PR](https://github.com/example/repo/pull/42) and https://github.com/example/repo/pull/42/files\n\n## Changes\n\nKeep the response readable while `workspaceId` stays compact. 正文大小保持不变，辅助信息退后。" } } },
  ] });
  await persistSessionFixture(page, { sessionId: "other-resource-task", title: "Other resource task", agentId: "codex-acp", cwd: "", acpSessionId: "", events: [] });
  await page.reload();
  await page.getByRole("button", { name: "Resource task", exact: true }).click();
  const resourceButton = page.getByRole("button", { name: "Task resources", exact: true });
  const terminalButton = page.getByRole("button", { name: "Open terminal", exact: true });
  const geometry = await resourceButton.boundingBox();
  const terminalGeometry = await terminalButton.boundingBox();
  expect(geometry!.height).toBe(terminalGeometry!.height);
  expect(geometry!.y).toBe(terminalGeometry!.y);
  expect(await resourceButton.evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region"))).toBe("no-drag");
  const rail = page.getByRole("navigation", { name: "Task resources" });
  await page.getByRole("button", { name: "Task resources", exact: true }).click();
  await expect(page.locator('[data-resource-docked]')).toBeVisible();

  await expect.poll(() => page.locator('header').first().locator('..').evaluate(el => parseFloat(getComputedStyle(el).paddingRight))).toBeLessThan(30);
  await expect(rail.getByRole("heading", { name: "Outputs", exact: true })).toHaveCount(0);
  const panel = await page.locator("[data-resource-docked]").boundingBox();
  expect(panel!.height).toBeLessThan(700);
  expect(panel!.width).toBeLessThanOrEqual(310);
  await expect(rail.getByRole("link")).toHaveCount(1);
  await rail.getByRole("button", { name: "Link PR / MR", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel("PR or MR URL") });
  await dialog.getByLabel("PR or MR URL").fill("https://git.example.com/team/repo/-/merge_requests/9");
  await dialog.getByRole("button", { name: "Link PR / MR" }).click();
  await expect(rail.getByRole("link")).toHaveCount(2);
  const heading = page.getByRole("heading", { name: "Changes", exact: true });
  expect(await heading.evaluate(el => getComputedStyle(el).fontSize)).toBe("15px");
  await page.screenshot({ path: testInfo.outputPath("resource-rail-desktop.png") });
  await page.setViewportSize({ width: 800, height: 720 });
  await expect(page.locator('[data-resource-docked]')).toHaveCount(0);
  await expect(rail).toBeVisible();
  await expect.poll(() => page.locator('header').first().locator('..').evaluate(el => parseFloat(getComputedStyle(el).paddingRight))).toBeLessThan(30);
  await page.screenshot({ path: testInfo.outputPath("resource-rail-narrow.png") });
  await page.reload();
  await page.getByRole("button", { name: "Resource task", exact: true }).click();
  await page.getByRole("button", { name: "Task resources", exact: true }).click();
  await expect(rail.getByRole("link")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Other resource task", exact: true }).click();
  await page.getByRole("button", { name: "Task resources", exact: true }).click();
  await expect(rail.getByRole("link")).toHaveCount(0);
  await expect(rail.getByRole("heading", { name: "Related PRs / MRs" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Resource task", exact: true }).click();
  await page.getByRole("button", { name: "Task resources", exact: true }).click();
  await rail.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.locator('[data-right-panel-collapsed="false"]')).toBeVisible();
});

test("resource docking preserves the visible paragraph in a long transcript", async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 900 });
  await enableAgent(page, "codex-acp");
  await persistSessionFixture(page, { sessionId: "resource-scroll", title: "Resource scroll", agentId: "codex-acp", cwd: "", acpSessionId: "", events: [
    { type: "user_prompt", data: { text: "Long answer" } },
    { type: "agent_message_chunk", data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: Array.from({ length: 60 }, (_, i) => `Paragraph ${i}: ${"A long readable line for checking layout and scroll stability. ".repeat(8)}`).join("\n\n") } } },
  ] });
  await page.reload();
  await page.getByRole("button", { name: "Resource scroll", exact: true }).click();
  const paragraph = page.locator('[data-chat-render-turn] p').filter({ hasText: /^Paragraph 30:/ });
  await expect(paragraph).toBeAttached();
  await page.waitForTimeout(1600); // Let the initial history landing settle finish.
  await paragraph.evaluate(el => el.scrollIntoView({ block: "start" }));
  const before = (await paragraph.boundingBox())!.y;
  const toggle = page.getByRole("button", { name: "Task resources", exact: true });
  const beforeWidth = await paragraph.evaluate(el => el.getBoundingClientRect().width);
  await toggle.click();
  await expect(page.locator('[data-resource-docked]')).toBeVisible();
  expect(await paragraph.evaluate(el => el.getBoundingClientRect().width)).toBe(beforeWidth);
  await page.waitForTimeout(350);
  expect(Math.abs((await paragraph.boundingBox())!.y - before)).toBeLessThan(3);
  await toggle.click();
  await expect(page.locator('[data-resource-docked]')).toHaveCount(0);
  await page.waitForTimeout(350);
  expect(Math.abs((await paragraph.boundingBox())!.y - before)).toBeLessThan(3);
});


test("resource overlay does not squeeze a medium-width conversation", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await enableAgent(page, "codex-acp");
  await persistSessionFixture(page, { sessionId: "overlay-task", title: "Overlay task", agentId: "codex-acp", cwd: "", acpSessionId: "", events: [
    { type: "user_prompt", data: { text: "Keep this width" } },
    { type: "agent_message_chunk", data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "The panel must overlay when the right gutter is too small." } } },
  ] });
  await page.reload();
  await page.getByRole("button", { name: "Overlay task", exact: true }).click();
  const column = page.locator("[data-chat-column='turns']");
  await expect(column).toBeVisible();
  const before = await column.boundingBox();
  await page.getByRole("button", { name: "Task resources", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Task resources" })).toBeVisible();
  await expect(page.locator("[data-resource-docked]")).toHaveCount(0);
  expect(await column.boundingBox()).toEqual(before);
});

test("task chrome uses the shared typography roles at actual size", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await enableAgent(page, "codex-acp");
  await persistSessionFixture(page, { sessionId: "type-task", title: "Typography task", agentId: "codex-acp", cwd: "", acpSessionId: "", events: [
    { type: "user_prompt", data: { text: "Typography" } },
    { type: "agent_message_chunk", data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "## Section\n\nReadable body text.\n\n##### Detail\n\n- List item\n\n> Quoted text\n\nInline `value`\n\n```ts\nconst value = 1;\n```\n\n| Key | Value |\n| --- | --- |\n| a | b |" } } },
  ] });
  await page.reload();
  await page.getByRole("button", { name: "Typography task", exact: true }).click();
  const size = (el: Element) => getComputedStyle(el).fontSize;
  expect(await page.getByRole("button", { name: "Typography task", exact: true }).evaluate(size)).toBe("13px");
  expect(await page.getByText("Readable body text.", { exact: true }).evaluate(size)).toBe("14px");
  await page.getByRole("button", { name: "Task resources", exact: true }).click();
  const markdown = page.locator(".chat-markdown").filter({ hasText: "Readable body text." }).last();
  expect(await markdown.locator("h5").evaluate(size)).toBe("14px");
  expect(await markdown.locator("li").evaluate(size)).toBe("14px");
  expect(await markdown.locator("blockquote").evaluate(size)).toBe("14px");
  expect(await markdown.locator("pre code").evaluate(size)).toBe("13px");
  expect(await markdown.locator("p code").evaluate(size)).toBe("13px");
  expect(await markdown.locator("td").first().evaluate(size)).toBe("13px");
  const rail = page.getByRole("navigation", { name: "Task resources" });
  expect(await rail.getByRole("heading", { name: "Task", exact: true }).evaluate(size)).toBe("13px");
  expect(await rail.getByRole("status").evaluate(size)).toBe("12px");
});
