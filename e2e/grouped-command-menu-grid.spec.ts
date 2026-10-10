import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  assertGroupedCommandGridAligned,
  captureGroupedMenuGridEvidence,
  measureGroupedCommandMenuGrid,
} from "./grouped-command-menu-grid";
import {
  enableAgent,
  hostPickerPanel,
  injectEvent,
  injectSession,
  openRuntimeLocationPicker,
} from "./helpers";
import {
  seedProjectPickerGridFixture,
  seedWorkspacePickerFixture,
} from "./grouped-command-menu-fit.shared";

test("workspace picker single grid", async ({ page, home }) => {
  test.setTimeout(120_000);
  await seedWorkspacePickerFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: "Workspace fit", exact: true }).click();
  await page.locator('[data-composer-footer-control="workspace"]').click();
  const panel = page.getByTestId("composer-workspace-picker-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const grid = await measureGroupedCommandMenuGrid(panel);
  const evidenceDir = process.env.PR56_EVIDENCE_DIR;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    const label = process.env.PR56_EVIDENCE_LABEL ?? "workspace-grid.png";
    await captureGroupedMenuGridEvidence(
      page,
      panel,
      join(evidenceDir, label),
      join(evidenceDir, label.replace(/\.png$/i, ".metrics.json")),
    );
  }
  assertGroupedCommandGridAligned(grid);
});

test("composer host picker single grid", async ({ page, home }) => {
  test.setTimeout(120_000);
  await seedWorkspacePickerFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await openRuntimeLocationPicker(page);
  const panel = hostPickerPanel(page);
  const grid = await measureGroupedCommandMenuGrid(panel);
  const evidenceDir = process.env.PR56_EVIDENCE_DIR;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    const label = process.env.PR56_EVIDENCE_LABEL ?? "composer-host-grid.png";
    await captureGroupedMenuGridEvidence(
      page,
      panel,
      join(evidenceDir, label),
      join(evidenceDir, label.replace(/\.png$/i, ".metrics.json")),
    );
  }
  assertGroupedCommandGridAligned(grid);
});

test("sidebar host picker single grid", async ({ page }) => {
  test.setTimeout(120_000);
  await enableAgent(page, "codex-acp");
  const row = page.getByTestId("sidebar-local-runtime-row");
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  const panel = page.getByTestId("sidebar-host-picker-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const grid = await measureGroupedCommandMenuGrid(panel);
  const evidenceDir = process.env.PR56_EVIDENCE_DIR;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    const label = process.env.PR56_EVIDENCE_LABEL ?? "sidebar-host-grid.png";
    await captureGroupedMenuGridEvidence(
      page,
      panel,
      join(evidenceDir, label),
      join(evidenceDir, label.replace(/\.png$/i, ".metrics.json")),
    );
  }
  assertGroupedCommandGridAligned(grid);
});

function manyGroupedModels() {
  const providers = ["anthropic-proxy", "openai-codex", "devin"];
  return providers.map((provider) => ({
    group: provider,
    name: provider,
    options: Array.from({ length: 4 }, (_, index) => ({
      value: `${provider}-${index}`,
      name: `${provider} model ${index}`,
    })),
  }));
}

test("model picker submenu single grid", async ({ page }) => {
  test.setTimeout(120_000);
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "model-grid",
    event: {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "openai-codex-0",
          options: manyGroupedModels(),
        },
      ],
    },
  });
  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
  const panel = page.getByTestId("composer-select-menu-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const grid = await measureGroupedCommandMenuGrid(panel);
  const evidenceDir = process.env.PR56_EVIDENCE_DIR;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    const label = process.env.PR56_EVIDENCE_LABEL ?? "model-grid.png";
    await captureGroupedMenuGridEvidence(
      page,
      panel,
      join(evidenceDir, label),
      join(evidenceDir, label.replace(/\.png$/i, ".metrics.json")),
    );
  }
  assertGroupedCommandGridAligned(grid);
});
