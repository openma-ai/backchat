import { execFile as execFileCallback } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./fixtures";

const execFile = promisify(execFileCallback);
const artifactDir = "/opt/cursor/artifacts/screenshots/composer-footer-trigger-open";

async function compositedBackground(
  locator: import("@playwright/test").Locator,
) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const alphaOf = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3]!;
    };
    const layers = [getComputedStyle(element).backgroundColor];
    let surface: Element | null = element.parentElement;
    while (surface) {
      const color = getComputedStyle(surface).backgroundColor;
      layers.push(color);
      if (alphaOf(color) === 255) break;
      surface = surface.parentElement;
    }
    context.clearRect(0, 0, 1, 1);
    for (const color of layers.reverse()) {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    }
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a };
  });
}

test("footer triggers paint open wash on first menu open", async ({ page, home }) => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });

  const repo = join(home, "footer-trigger-repo");
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
      project_id: "footer-trigger-demo",
      name: "Host demo",
      source_folders: [path],
      primary_folder: path,
    });
  }, repo);
  await page.reload();

  await page.getByRole("button", { name: "新建对话", exact: true }).click();

  const runtime = page.locator('[data-composer-footer-control="runtime"]');
  const project = page.locator('[data-composer-footer-control="project"]');

  const restBackground = await compositedBackground(runtime);
  await runtime.click();
  await expect(runtime).toHaveAttribute("aria-expanded", "true");
  const firstOpenBackground = await compositedBackground(runtime);
  expect(firstOpenBackground.a).toBe(255);
  expect(
    Math.abs(firstOpenBackground.r - restBackground.r) +
      Math.abs(firstOpenBackground.g - restBackground.g) +
      Math.abs(firstOpenBackground.b - restBackground.b),
  ).toBeGreaterThan(0);
  await page.screenshot({
    path: join(artifactDir, "host-trigger-first-open.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(runtime).toHaveAttribute("aria-expanded", "false");

  await runtime.click();
  await expect(runtime).toHaveAttribute("aria-expanded", "true");
  const secondOpenBackground = await compositedBackground(runtime);
  expect(secondOpenBackground.a).toBe(255);
  await page.screenshot({
    path: join(artifactDir, "host-trigger-second-open.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");

  await project.click();
  await expect(project).toHaveAttribute("aria-expanded", "true");
  const projectOpen = await compositedBackground(project);
  expect(projectOpen.a).toBe(255);
  await page.screenshot({
    path: join(artifactDir, "project-trigger-first-open.png"),
    animations: "disabled",
  });
});
