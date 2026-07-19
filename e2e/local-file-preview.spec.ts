import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { injectEvent, injectSession, launchApp } from "./helpers";

test("generated documents preview in app and keep native Open in actions", async () => {
  const { page, home, cleanup } = await launchApp();
  try {
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
  } finally {
    await cleanup();
  }
});
