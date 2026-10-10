import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectGroupedCommandOpensOnCurrentChoice,
  measureGroupedCommandMenuGrid,
  groupedCommandGridLinePositions,
  groupedCommandGridReferenceLinePositions,
  burnGroupedCommandGridLines,
} from "./grouped-command-menu-grid";
import {
  seedProjectPickerGridFixture,
  seedWorkspacePickerFixture,
} from "./grouped-command-menu-fit.shared";
import {
  enableAgent,
  hostPickerPanel,
  injectEvent,
  injectSession,
  openRuntimeLocationPicker,
} from "./helpers";

const evidenceDir =
  process.env.PR56_EVIDENCE_DIR ??
  "/opt/cursor/artifacts/pr56-evidence/item-08-project-picker-open-highlight";

test("project picker opens on checked project row", async ({ page, home }) => {
  test.setTimeout(120_000);
  await seedProjectPickerGridFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.locator('[data-composer-footer-control="project"]').click();
  const panel = page.getByTestId("composer-project-picker-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expectGroupedCommandOpensOnCurrentChoice(panel, { requireChecked: true });

  await mkdir(evidenceDir, { recursive: true });
  const popover = panel.locator(
    "xpath=ancestor::*[@data-slot='popover-content'][1]",
  );
  await popover.screenshot({
    path: join(evidenceDir, "pr-project-picker-open.png"),
    animations: "disabled",
  });

  const grid = await measureGroupedCommandMenuGrid(panel);
  const { iconLeft, textLeft } = groupedCommandGridLinePositions(grid);
  const png = await popover.screenshot({ animations: "disabled" });
  const gridPng = await burnGroupedCommandGridLines(
    png,
    iconLeft,
    textLeft,
    groupedCommandGridReferenceLinePositions(),
  );
  await writeFile(join(evidenceDir, "pr-grid-lines.png"), gridPng);
  await writeFile(
    join(evidenceDir, "pr-grid.metrics.json"),
    `${JSON.stringify(
      {
        grid,
        gridLines: { iconLeft, textLeft },
        referenceLines: groupedCommandGridReferenceLinePositions(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});

test("workspace picker opens on checked workspace row", async ({ page, home }) => {
  test.setTimeout(120_000);
  await seedWorkspacePickerFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: "Workspace fit", exact: true }).click();
  await page.locator('[data-composer-footer-control="workspace"]').click();
  const panel = page.getByTestId("composer-workspace-picker-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expectGroupedCommandOpensOnCurrentChoice(panel, { requireChecked: true });
});

test("composer host picker opens on checked local row", async ({ page, home }) => {
  test.setTimeout(120_000);
  await seedWorkspacePickerFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await openRuntimeLocationPicker(page);
  const panel = hostPickerPanel(page);
  await expectGroupedCommandOpensOnCurrentChoice(panel, { requireChecked: true });
});

test("sidebar host picker opens on checked local row", async ({ page }) => {
  test.setTimeout(120_000);
  await enableAgent(page, "codex-acp");
  await page.getByTestId("sidebar-local-runtime-row").click();
  const panel = page.getByTestId("sidebar-host-picker-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expectGroupedCommandOpensOnCurrentChoice(panel, { requireChecked: true });
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

test("model picker submenu opens on active model row", async ({ page }) => {
  test.setTimeout(120_000);
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "model-open-highlight",
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
  await expectGroupedCommandOpensOnCurrentChoice(panel, { requireChecked: true });
});
