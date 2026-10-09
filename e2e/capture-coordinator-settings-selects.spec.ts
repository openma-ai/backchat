import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "./fixtures";

const artifactDir = "/opt/cursor/artifacts/screenshots/coordinator-settings-selects";

test("coordinator settings selects: unified field chrome open and closed", async ({
  page,
  home,
}) => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });

  await page.evaluate(
    async ({ node, agent, home: projectHome }) => {
      await window.backchat.settingsPatch({
        agents: [
          {
            id: "codex-acp",
            enabled: true,
            command_override: node,
            args_override: [agent],
            env: [],
          },
        ],
      });
      await window.backchat.projectSave({
        project_id: "coord-select-demo",
        name: "Coordinator demo",
        source_folders: [projectHome],
        primary_folder: projectHome,
      });
    },
    {
      node: process.execPath,
      agent: resolve("e2e/fixtures/fake-acp-agent.mjs"),
      home,
    },
  );
  await page.reload();
  const row = page.locator('[data-sidebar-project="project:coord-select-demo"]');
  await row.hover();
  await row.getByRole("button", { name: /project actions/i }).click();
  await page.getByRole("menuitem", { name: /Project settings/i }).click();
  await page.getByRole("button", { name: "Configure", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Coordinator settings", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Agents", exact: true }).click();

  const execution = dialog.getByRole("combobox", {
    name: "Execution location",
    exact: true,
  });
  await expect(execution).toBeVisible();
  await page.screenshot({
    path: join(artifactDir, "execution-location-closed.png"),
    animations: "disabled",
  });
  await execution.click();
  await expect(execution).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({
    path: join(artifactDir, "execution-location-open.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");

  const coordinator = dialog.getByRole("combobox", {
    name: "Coordinator agent",
    exact: true,
  });
  await coordinator.click();
  const firstAgent = page.getByRole("option").first();
  await expect(firstAgent).toBeVisible();
  await expect(
    firstAgent.locator(
      '[data-grouped-command-grid="icon"] svg, [data-agent-icon-source], [data-grouped-command-grid="icon"] [role="img"]',
    ),
  ).toBeVisible();
  await page.screenshot({
    path: join(artifactDir, "coordinator-agent-open.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: join(artifactDir, "coordinator-agent-closed.png"),
    animations: "disabled",
  });
});
