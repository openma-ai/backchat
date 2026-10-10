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

async function seedProjectPickerGridFixture(
  page: import("@playwright/test").Page,
  home: string,
) {
  const alphaDir = join(home, "picker-grid-alpha");
  const betaDir = join(home, "picker-grid-beta");
  await fsMkdir(alphaDir, { recursive: true });
  await fsMkdir(betaDir, { recursive: true });
  await page.evaluate(async ({ alphaDir, betaDir }) => {
    localStorage.setItem("backchat:workspace-intro-seen:v1", "1");
    await window.backchat.projectSave({
      project_id: "picker-grid-a",
      name: "Alpha workspace",
      source_folders: [alphaDir],
      primary_folder: alphaDir,
    });
    const beta = {
      project_id: "picker-grid-b",
      name: "Beta monorepo",
      source_folders: [betaDir],
      primary_folder: betaDir,
    };
    await window.backchat.projectSave(beta);
    await window.backchat.projectSave(beta);
  }, { alphaDir, betaDir });
  await page.reload();
}

type ProjectPickerGridRow = {
  id: string;
  iconLeft: number;
  textLeft: number;
  iconWidth: number;
};

function measureProjectPickerSingleGrid(panel: import("@playwright/test").Locator) {
  return panel.evaluate((rootEl) => {
    const popover = (rootEl.closest("[data-slot='popover-content']") ??
      rootEl.querySelector("[data-slot='popover-content']") ??
      rootEl) as HTMLElement;
    const scope = popover;
    const popoverLeft = popover.getBoundingClientRect().left;
    const rel = (value: number) => Math.round(value - popoverLeft);
    const textContentLeft = (el: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().left;
    };

    const rows: ProjectPickerGridRow[] = [];
    const searchWrap = scope.querySelector(
      '[data-slot="command-input-wrapper"]',
    ) as HTMLElement | null;
    const searchIcon = searchWrap?.querySelector("svg") as SVGElement | null;
    const searchInput = scope.querySelector(
      '[data-slot="command-input"]',
    ) as HTMLElement | null;
    if (searchWrap && searchIcon && searchInput) {
      const trackRect = searchIcon.getBoundingClientRect();
      rows.push({
        id: "search",
        iconLeft: rel(trackRect.left),
        textLeft: rel(searchInput.getBoundingClientRect().left),
        iconWidth: Math.round(trackRect.width),
      });
    }

    for (const heading of Array.from(
      scope.querySelectorAll(
        "[data-grouped-command-group-heading], [cmdk-group-heading]",
      ),
    ) as HTMLElement[]) {
      const headingText = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
      rows.push({
        id: `heading:${headingText.slice(0, 24)}`,
        iconLeft: rel(heading.getBoundingClientRect().left),
        textLeft: rel(textContentLeft(heading)),
        iconWidth: 0,
      });
    }

    for (const item of Array.from(
      scope.querySelectorAll('[data-slot="command-item"]'),
    ) as HTMLElement[]) {
      const iconSlot = item.querySelector(
        '[data-grouped-command-grid="icon"]',
      ) as HTMLElement | null;
      const icon =
        (iconSlot?.querySelector("svg") as SVGElement | null) ??
        (item.querySelector("svg") as SVGElement | null);
      const label =
        (item.querySelector(
          '[data-grouped-command-grid="label"] span',
        ) as HTMLElement | null) ??
        (item.querySelector("span.truncate") as HTMLElement | null) ??
        (item.querySelector(
          '[data-grouped-command-grid="label"]',
        ) as HTMLElement | null) ??
        (Array.from(item.querySelectorAll("span")).find(
          (node) =>
            !node.classList.contains("app-select-selected") &&
            !node.closest('[data-grouped-command-grid="icon"]'),
        ) as HTMLElement | undefined);
      if (!icon || !label) continue;
      const iconRect = (iconSlot ?? icon).getBoundingClientRect();
      const text = (item.textContent ?? "").replace(/\s+/g, " ").trim();
      rows.push({
        id: text.slice(0, 32),
        iconLeft: rel(iconRect.left),
        textLeft: rel(label.getBoundingClientRect().left),
        iconWidth: Math.round(iconRect.width),
      });
    }

    const iconLefts = rows.map((row) => row.iconLeft);
    const textLefts = rows.map((row) => row.textLeft);
    return {
      popoverHeight: Math.round(popover.getBoundingClientRect().height),
      rows,
      iconLeftMin: Math.min(...iconLefts),
      iconLeftMax: Math.max(...iconLefts),
      textLeftMin: Math.min(...textLefts),
      textLeftMax: Math.max(...textLefts),
    };
  });
}

async function screenshotProjectPickerGridReference(
  page: import("@playwright/test").Page,
  panel: import("@playwright/test").Locator,
  metrics: {
    rows: ProjectPickerGridRow[];
    iconLeftMin: number;
    textLeftMin: number;
  },
  path: string,
): Promise<void> {
  const lines = await panel.evaluate(
    ({ iconLeft, textLeft }) => {
      const scope =
        document.querySelector('[data-testid="composer-project-picker-panel"]') ??
        document.querySelector('[data-slot="popover-content"][data-state="open"]');
      const popover = (scope?.closest("[data-slot='popover-content']") ??
        scope) as HTMLElement | null;
      if (!popover) return { top: 0, height: 0, iconX: 0, textX: 0 };
      const rect = popover.getBoundingClientRect();
      const iconX = rect.left + iconLeft;
      const textX = rect.left + textLeft;
      for (const el of document.querySelectorAll("[data-pr56-grid-line]")) {
        el.remove();
      }
      for (const [x, color] of [
        [iconX, "rgba(239, 68, 68, 0.9)"],
        [textX, "rgba(59, 130, 246, 0.9)"],
      ] as const) {
        const line = document.createElement("div");
        line.setAttribute("data-pr56-grid-line", "true");
        line.style.cssText = [
          "position:fixed",
          `left:${x}px`,
          `top:${rect.top}px`,
          `height:${rect.height}px`,
          "width:2px",
          `background:${color}`,
          "pointer-events:none",
          "z-index:2147483646",
        ].join(";");
        document.body.appendChild(line);
      }
      return {
        top: rect.top,
        height: rect.height,
        iconX,
        textX,
      };
    },
    { iconLeft: metrics.iconLeftMin, textLeft: metrics.textLeftMin },
  );
  await page.waitForTimeout(50);
  const popover = panel.locator(
    "xpath=ancestor-or-self::*[@data-slot='popover-content'][1]",
  );
  const shotTarget =
    (await panel.getAttribute("data-testid")) === "composer-project-picker-panel"
      ? panel.locator("xpath=ancestor::*[@data-slot='popover-content'][1]")
      : panel;
  await shotTarget.screenshot({ path, animations: "disabled" });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-pr56-grid-line]")) {
      el.remove();
    }
  });
}

test("project picker single grid (search + all rows)", async ({ page, home }) => {
  test.setTimeout(120_000);
  await seedProjectPickerGridFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.locator('[data-composer-footer-control="project"]').click();
  const panelByTestId = page.getByTestId("composer-project-picker-panel");
  const panel = (await panelByTestId.count())
    ? panelByTestId
    : page.locator('[data-slot="popover-content"][data-state="open"]').last();
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator('[data-slot="command-item"]').first()).toBeVisible({
    timeout: 10_000,
  });

  const metrics = await measureProjectPickerSingleGrid(panel);

  const evidenceDir = process.env.PR56_EVIDENCE_DIR;
  const label = process.env.PR56_EVIDENCE_LABEL ?? "project-picker-grid.png";
  if (evidenceDir) {
    await fsMkdir(evidenceDir, { recursive: true });
    await screenshotProjectPickerGridReference(
      page,
      panel,
      metrics,
      join(evidenceDir, label),
    );
    await writeFile(
      join(evidenceDir, label.replace(/\.png$/i, ".metrics.json")),
      `${JSON.stringify(metrics, null, 2)}\n`,
      "utf8",
    );
  }

  expect(metrics.rows.length).toBeGreaterThanOrEqual(6);
  const iconRows = metrics.rows.filter((row) => !row.id.startsWith("heading:"));
  const iconLefts = iconRows.map((row) => row.iconLeft);
  expect(Math.max(...iconLefts) - Math.min(...iconLefts)).toBe(0);
  expect(metrics.textLeftMax - metrics.textLeftMin).toBe(0);
  const widths = iconRows.map((row) => row.iconWidth).filter((w) => w > 0);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
});

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
