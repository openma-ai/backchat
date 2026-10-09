import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";

const artifactDir = "/opt/cursor/artifacts/screenshots/project-picker-filter";

test("capture project picker alignment and stable height while filtering", async ({
  page,
  home,
}) => {
  test.setTimeout(180_000);
  await mkdir(artifactDir, { recursive: true });

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(async (next) => {
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        appearance: { ...current.appearance, theme: next, language: "en" },
      });
    }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme-mode", theme);

    await page.evaluate(async (path) => {
      await window.backchat.projectSave({
        project_id: "picker-align-demo",
        name: "Alpha workspace",
        source_folders: [path],
        primary_folder: path,
      });
      await window.backchat.projectSave({
        project_id: "picker-align-beta",
        name: "Beta monorepo",
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
    const search = panel.locator('[data-slot="command-input"]');
    await expect(search).toBeFocused();

    const queries = ["", "a", "alpha", "zzznomatch"];
    const heights: number[] = [];

    for (let index = 0; index < queries.length; index++) {
      const query = queries[index];
      await search.fill(query);
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      heights.push(box!.height);
      const slug = query.length === 0 ? "browse" : query;
      await page.screenshot({
        path: join(artifactDir, `${theme}-typing-${index}-${slug}.png`),
        animations: "disabled",
      });
    }

    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  }
});
