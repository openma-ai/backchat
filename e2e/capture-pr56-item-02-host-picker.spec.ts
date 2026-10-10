/**
 * PR56 item 2 — composer host picker content-fit height + visible checkmarks.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { enableAgent, launchApp } from "./helpers";

const VIEWPORT = { width: 1400, height: 900 };
const root = process.env.PR56_ITEM_DIR ?? "/opt/cursor/artifacts/pr56-item-02";

function shot(phase: "before" | "after", name: string) {
  return join(root, phase, name);
}

test.describe("PR56 item 02 host picker", () => {
  const phase = (process.env.PR56_ITEM_PHASE ?? "after") as "before" | "after";

  test.beforeAll(async () => {
    await mkdir(join(root, phase), { recursive: true });
  });

  test("composer host picker panel fits content with checkmark", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await enableAgent(page, "codex-acp");
      await page.locator('[data-composer-footer-control="runtime"]').click();
      const panel = page.getByTestId("composer-host-picker-panel");
      if (phase === "after") {
        await expect(panel).toBeVisible({ timeout: 10_000 });
        await expect(
          panel.locator('[data-slot="command-item"][data-checked="true"]'),
        ).toBeVisible();
      } else {
        await page.waitForTimeout(400);
      }
      const dropdown = panel.locator(
        "xpath=ancestor::*[@data-slot='dropdown-menu-content'][1]",
      );
      await page.waitForTimeout(phase === "after" ? 200 : 300);
      await dropdown.screenshot({
        path: shot(phase, "02-host-picker-panel.png"),
      });
    } finally {
      await cleanup();
    }
  });
});
