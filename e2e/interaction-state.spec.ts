import { test, expect } from "./fixtures";
import { persistSessionFixture } from "./helpers";

test("selection clears globally and annotation-only history remains visible", async ({ page }) => {
  await persistSessionFixture(page, { sessionId: "annotation-audit", title: "Annotation audit", agentId: "codex-acp", cwd: "", acpSessionId: "", events: [
    { type: "user_prompt", data: { text: "Hello" } },
    { type: "agent_message_chunk", data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Response to annotate." } } },
    { type: "user_prompt", data: { text: "", annotations: [{ id: "a", source_session_id: "annotation-audit", source_turn_id: "first", text: "Quoted response", comment: "Explain this quote" }] } },
  ] });
  await page.reload();
  await page.getByRole("button", { name: "Annotation audit", exact: true }).click();
  const annotations = page.locator('[data-prompt-annotations]');
  await expect(annotations.getByRole("button", { name: "Annotations · 1" })).toBeVisible();
  await expect(page.getByText("Explain this quote", { exact: true })).toHaveCount(0);
  await annotations.getByRole("button").click();
  await expect(page.getByRole("dialog", { name: "Response annotations" })).toContainText("Explain this quote");
  await expect(page.getByRole("dialog").getByRole("button", { name: /Remove annotation/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByText("[1 annotation]", { exact: true })).toHaveCount(0);
  const response = page.getByText("Response to annotate.", { exact: true });
  await response.evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.locator('[data-response-selection-toolbar]')).toBeVisible();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(page.locator('[data-response-selection-toolbar]')).toBeHidden();
});

test("project padding is clickable and disclosure state survives settings and reload", async ({ page }) => {
  await persistSessionFixture(page, { sessionId: "sidebar-audit", title: "Sidebar audit", agentId: "codex-acp", cwd: "/tmp/sidebar-audit-project", acpSessionId: "", events: [] });
  await page.reload();
  const project = page.locator('button[aria-label="sidebar-audit-project"]');
  await expect(project).toBeVisible();
  const row = project.locator('..');
  const buttonBox = (await project.boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  expect(buttonBox.height).toBeGreaterThanOrEqual(rowBox.height - 1);
  await project.click({ position: { x: 30, y: 2 } });
  await expect(project).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await expect(project).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(project).toHaveAttribute("aria-expanded", "true");
});

test("Chinese annotation actions and keyboard focus remain visible", async ({ page }) => {
  await persistSessionFixture(page, { sessionId: "zh-annotation", title: "中文批注", agentId: "codex-acp", cwd: "", acpSessionId: "", events: [
    { type: "user_prompt", data: { text: "你好" } },
    { type: "agent_message_chunk", data: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "需要批注的回复。" } } },
  ] });
  await page.reload();
  await page.evaluate(async () => {
    const settings = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({ appearance: { ...settings.appearance, language: "zh-CN" } });
  });
  await page.getByRole("button", { name: "中文批注", exact: true }).click();
  await page.getByText("需要批注的回复。", { exact: true }).evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "添加到输入", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "回复批注", exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("button", { name: "录制语音批注", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  // Keyboard modality must retain a visible outline even on the transparent runtime control.
  await page.keyboard.press("Tab");
  const runtime = page.locator('.runtime-location-control').first();
  await runtime.focus();
  const focus = await runtime.evaluate(el => ({ visible: el.matches(':focus-visible'), width: parseFloat(getComputedStyle(el).outlineWidth), style: getComputedStyle(el).outlineStyle }));
  expect(focus.visible).toBe(true);
  expect(focus.style).toBe("solid");
  // Electron's 115% default zoom rounds the two-pixel outline to device pixels.
  expect(focus.width).toBeGreaterThanOrEqual(1.5);
});
