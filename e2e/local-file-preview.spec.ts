import { expect, test } from "./fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { enableAgent, injectEvent, injectSession } from "./helpers";

test("generated documents preview in app and keep native Open in actions", async ({ page, home }) => {
    await enableAgent(page, "codex-acp");
    const workspace = join(home, "document-preview");
    const sourcePath = join(workspace, "未命名文档.docx");
    const previewPath = join(workspace, "docx_render_final", "未命名文档.pdf");
    await mkdir(join(workspace, "docx_render_final"), { recursive: true });
    await writeFile(sourcePath, "docx");
    await writeFile(previewPath, "%PDF-1.4\n%%EOF");

    const sid = await injectSession(page, { agentId: "codex-acp", cwd: workspace });
    const turnId = "turn-document-preview";
    await injectEvent(page, {
      type: "session.event",
      session_id: sid,
      turn_id: turnId,
      event: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `[Open document](${sourcePath})`,
        },
      },
    });
    await injectEvent(page, {
      type: "session.complete",
      session_id: sid,
      turn_id: turnId,
    });

    await page.getByRole("link", { name: "Open document" }).click();

    const preview = page.locator('[data-browser-visible="true"]');
    await expect(preview.getByText("未命名文档.docx", { exact: true })).toBeVisible();
    await preview.locator(`button[aria-label="Open ${sourcePath}"]`).click();
    await expect(page.getByText("Default app", { exact: true })).toBeVisible();
    await expect(page.getByText("Show in Finder", { exact: true })).toBeVisible();
});

test("folder references open the native file manager without an artifact tab", async ({ page, app, home }) => {
  const folder = join(home, "backend");
  await mkdir(folder);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("uiFs:openPath");
    ipcMain.handle("uiFs:openPath", (_event, input) => {
      (globalThis as unknown as { openedFolder: string }).openedFolder = input.path;
      return "";
    });
  });
  const sid = await injectSession(page, { agentId: "codex-acp", cwd: home });
  await injectEvent(page, {
    type: "session.event", session_id: sid, turn_id: "folder-turn",
    event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "[backend](./backend)" } },
  });
  await injectEvent(page, { type: "session.complete", session_id: sid, turn_id: "folder-turn" });
  const link = page.getByRole("link", { name: "backend", exact: true });
  await expect(link).toHaveAttribute("data-markdown-file-link", "true");
  await expect(link).toHaveAttribute("title", folder);
  expect(await page.evaluate(path => window.backchat.uiFsResolvePreview({ path }), folder)).toMatchObject({ kind: "directory" });
  await link.click();
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { openedFolder: string }).openedFolder)).toBe(folder);
  await expect(page.locator('[data-browser-visible="true"]')).toHaveCount(0);
});
