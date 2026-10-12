import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";

const artifactDir = "/opt/cursor/artifacts/screenshots/project-picker-upward-gap";

test("capture upward project picker gap above trigger", async ({ page, home }) => {
  test.setTimeout(180_000);
  await mkdir(artifactDir, { recursive: true });

  await page.evaluate(async (path) => {
    await window.backchat.projectSave({
      project_id: "picker-gap-demo",
      name: "Gap demo project",
      source_folders: [path],
      primary_folder: path,
    });
  }, home);
  await page.reload();

  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const trigger = page.locator('[data-composer-footer-control="project"]');
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  const panel = page.getByTestId("composer-project-picker-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const [triggerBox, panelBox] = await page.evaluate(() => {
    const triggerEl = document.querySelector(
      '[data-composer-footer-control="project"]',
    );
    const panelEl = document.querySelector(
      '[data-testid="composer-project-picker-panel"]',
    );
    const triggerRect = triggerEl?.getBoundingClientRect();
    const panelRect = panelEl?.getBoundingClientRect();
    return [
      triggerRect
        ? { top: triggerRect.top, bottom: triggerRect.bottom }
        : null,
      panelRect ? { top: panelRect.top, bottom: panelRect.bottom } : null,
    ] as const;
  });

  expect(triggerBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  const visualGap = triggerBox!.top - panelBox!.bottom;
  expect(Math.abs(visualGap)).toBeLessThanOrEqual(0.5);

  await page.screenshot({
    path: join(artifactDir, "light-project-picker-upward-gap.png"),
    animations: "disabled",
  });
});
