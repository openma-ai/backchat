import { execFile as execFileCallback } from "node:child_process";
import { mkdir as fsMkdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./fixtures";
import { enableAgent, injectEvent, injectSession } from "./helpers";

const execFile = promisify(execFileCallback);
const artifactDir = "/opt/cursor/artifacts/screenshots/grouped-command-menu-fit";

function manyGroupedModels() {
  const providers = ["anthropic-proxy", "openai-codex", "devin"];
  return providers.map((provider) => ({
    group: provider,
    name: provider,
    options: Array.from({ length: 8 }, (_, index) => ({
      value: `${provider}-${index}`,
      name: `${provider} model ${index}`,
    })),
  }));
}

async function seedWorkspacePickerFixture(
  page: import("@playwright/test").Page,
  home: string,
) {
  const repo = join(home, "workspace-fit-repo");
  await fsMkdir(repo, { recursive: true });
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
    await window.backchat.projectSave({
      project_id: "workspace-fit-project",
      name: "Workspace fit",
      source_folders: [path],
      primary_folder: path,
    });
  }, repo);
  await page.reload();
}

test("workspace picker popover matches main chrome", async ({ page, home }) => {
  test.setTimeout(120_000);
  await seedWorkspacePickerFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: "Workspace fit", exact: true }).click();
  const workspaceTrigger = page.locator('[data-composer-footer-control="workspace"]');
  await expect(workspaceTrigger).toBeVisible({ timeout: 10_000 });
  await workspaceTrigger.click();
  const panel = page.getByTestId("composer-workspace-picker-panel");
  const popover = (await panel.count())
    ? panel.locator("xpath=ancestor::*[@data-slot='popover-content'][1]")
    : page.locator('[data-slot="popover-content"][data-state="open"]').last();
  await expect(popover).toBeVisible({ timeout: 10_000 });

  const metrics = await popover.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const popoverTop = rect.top;
    const command = el.querySelector('[data-slot="command"]') as HTMLElement | null;
    const itemNodes = el.querySelectorAll('[data-slot="command-item"]');
    const lastItem = itemNodes[itemNodes.length - 1] as HTMLElement | undefined;
    const commandRect = command?.getBoundingClientRect();
    const lastRect = lastItem?.getBoundingClientRect();
    const search = el.querySelector(
      '[data-slot="command-input-wrapper"]',
    ) as HTMLElement | null;
    const searchRect = search?.getBoundingClientRect();
    const rowHeights = Array.from(itemNodes).map((node) =>
      Math.round(node.getBoundingClientRect().height),
    );
    return {
      popoverHeight: Math.round(rect.height),
      commandHeight: commandRect ? Math.round(commandRect.height) : 0,
      searchRowHeight: searchRect ? Math.round(searchRect.height) : 0,
      bottomPaddingToPopover: lastRect
        ? Math.round(rect.bottom - lastRect.bottom)
        : 0,
      popoverSlackBelowCommand:
        commandRect ? Math.round(rect.bottom - commandRect.bottom) : 0,
      rowCount: itemNodes.length,
      rowHeights,
    };
  });

  const evidenceDir = process.env.PR56_EVIDENCE_DIR;
  if (evidenceDir) {
    await fsMkdir(evidenceDir, { recursive: true });
    const label = process.env.PR56_EVIDENCE_LABEL ?? "workspace-picker.png";
    await popover.screenshot({
      path: join(evidenceDir, label),
      animations: "disabled",
    });
    await writeFile(
      join(evidenceDir, label.replace(/\.png$/i, ".metrics.json")),
      `${JSON.stringify(metrics, null, 2)}\n`,
      "utf8",
    );
  }

  expect(metrics.popoverHeight).toBeLessThanOrEqual(220);
  expect(metrics.popoverHeight).toBeGreaterThanOrEqual(100);
  expect(metrics.searchRowHeight).toBe(36);
  expect(metrics.bottomPaddingToPopover).toBeLessThanOrEqual(9);
  expect(metrics.popoverSlackBelowCommand).toBe(0);
  expect(metrics.commandHeight).toBe(metrics.popoverHeight);
  expect(metrics.rowCount).toBeGreaterThanOrEqual(2);
});

test("host picker menu shrinks to few rows", async ({ page, home }) => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });

  const repo = join(home, "host-fit-repo");
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
    await window.backchat.projectSave({
      project_id: "host-fit-demo",
      name: "Host demo",
      source_folders: [path],
      primary_folder: path,
    });
  }, repo);
  await page.reload();
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();

  const runtimeTrigger = page.locator('[data-composer-footer-control="runtime"]');
  await runtimeTrigger.click();
  const panel = page.getByTestId("composer-host-picker-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeLessThan(220);

  await page.screenshot({
    path: join(artifactDir, "host-picker-fit-height.png"),
    animations: "disabled",
  });
});

test("model submenu shrinks when search filters to one row", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "menu-fit",
    event: {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "openai-codex-2",
          options: manyGroupedModels(),
        },
      ],
    },
  });

  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
  const panel = page.getByTestId("composer-select-menu-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const fullHeight = (await panel.boundingBox())?.height ?? 0;
  expect(fullHeight).toBeGreaterThan(120);

  const search = panel.locator('input[type="search"], input[cmdk-input]');
  await search.fill("devin 1");
  await expect(panel.getByText("openai-codex model 0")).toHaveCount(0);

  const filteredHeight = (await panel.boundingBox())?.height ?? 0;
  expect(filteredHeight).toBeLessThan(fullHeight - 40);
  expect(filteredHeight).toBeLessThan(220);
});

test("model submenu bottom aligns with primary run menu", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "menu-align",
    event: {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "openai-codex-2",
          options: manyGroupedModels(),
        },
      ],
    },
  });

  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  const primary = page.locator('[data-slot="dropdown-menu-content"]').last();
  await expect(primary).toBeVisible();
  await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
  const subPanel = page.getByTestId("composer-select-menu-panel");
  await expect(subPanel).toBeVisible({ timeout: 10_000 });

  const primaryBottom = await primary.evaluate((el) => el.getBoundingClientRect().bottom);
  const subBottom = await subPanel.evaluate((el) => el.getBoundingClientRect().bottom);
  expect(Math.abs(primaryBottom - subBottom)).toBeLessThanOrEqual(3);
});

test("model submenu keeps the parent Model row highlighted while open", async ({
  page,
}) => {
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "menu-parent-highlight",
    event: {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "openai-codex-2",
          options: manyGroupedModels(),
        },
      ],
    },
  });

  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  const modelTrigger = page.getByRole("menuitem", { name: /模型|Model/ }).first();
  await modelTrigger.hover();
  const subPanel = page.getByTestId("composer-select-menu-panel");
  await expect(subPanel).toBeVisible({ timeout: 10_000 });

  const wash = await modelTrigger.evaluate((element) => {
    const bg = getComputedStyle(element).backgroundColor;
    return bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
  });
  expect(wash).toBe(true);
});
