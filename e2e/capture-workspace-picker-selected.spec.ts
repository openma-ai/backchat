import { execFile as execFileCallback } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./fixtures";

const execFile = promisify(execFileCallback);
const artifactDir = "/opt/cursor/artifacts/screenshots/workspace-picker-selected";

test("host menu: selected 本机 row has no gray highlight", async ({ page, home }) => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });

  const repo = join(home, "host-demo-repo");
  await mkdir(repo, { recursive: true });
  await execFile("git", ["init", "--initial-branch=main", repo]);
  await execFile("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  ]);

  await page.evaluate(async (path) => {
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      appearance: { ...current.appearance, language: "zh-CN" },
    });
    await window.backchat.projectSave({
      project_id: "workspace-host-demo",
      name: "Host demo",
      source_folders: [path],
      primary_folder: path,
    });
  }, repo);
  await page.reload();

  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: "Host demo", exact: true }).click();

  const runtimeTrigger = page.locator('[data-composer-footer-control="runtime"]');
  await expect(runtimeTrigger).toContainText("本机");
  await runtimeTrigger.click();

  const localRow = page.getByRole("option", { name: "本机", exact: true });
  await expect(localRow).toBeVisible();
  await expect(localRow).toHaveAttribute("data-checked", "true");
  await expect(localRow).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await page.screenshot({
    path: join(artifactDir, "host-menu-local-selected-no-gray.png"),
    animations: "disabled",
  });
});

test("workspace menu: selected 本地 row has no gray highlight", async ({
  page,
  home,
}) => {
  test.setTimeout(120_000);

  const repo = join(home, "workspace-local-repo");
  await mkdir(repo, { recursive: true });
  await execFile("git", ["init", "--initial-branch=main", repo]);
  await execFile("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  ]);

  await page.evaluate(async (path) => {
    localStorage.setItem("backchat:workspace-intro-seen:v1", "1");
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      appearance: { ...current.appearance, language: "zh-CN" },
    });
    await window.backchat.projectSave({
      project_id: "workspace-local-demo",
      name: "Host demo",
      source_folders: [path],
      primary_folder: path,
    });
  }, repo);
  await page.reload();

  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: "Host demo", exact: true }).click();

  const workspaceTrigger = page.locator('[data-composer-footer-control="workspace"]');
  await expect(workspaceTrigger).toBeVisible({ timeout: 30_000 });

  await workspaceTrigger.click();
  const intro = page.getByRole("dialog", { name: /并行|parallel/i });
  if (await intro.isVisible().catch(() => false)) {
    await intro.getByRole("button", { name: /知道了|Got it/i }).click();
    await expect(intro).toBeHidden();
  }

  const localRow = page.locator(
    '[data-slot="command-item"][data-checked="true"]',
  );
  await expect(localRow).toBeVisible();
  await expect(localRow).toHaveAttribute("data-checked", "true");
  await expect(localRow).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});
