import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import {
  burnGroupedCommandGridLines,
  groupedCommandGridLinePositions,
  measureGroupedCommandMenuGrid,
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
  launchApp,
  openRuntimeLocationPicker,
} from "./helpers";

export const ITEM08_EVIDENCE_ROOT =
  process.env.PR56_ITEM08_DIR ??
  "/opt/cursor/artifacts/pr56-evidence-item08";

export const MAIN_APP_ROOT = "/tmp/backchat-main";
export const PR_APP_ROOT = "/workspace";

export const ITEM08_VIEWPORT = { width: 1280, height: 800 };

export type Item08Locale = "en" | "zh-CN";

export type GridLinePair = { iconLeft: number; textLeft: number };

export async function prepareAppearance(
  page: Page,
  language: Item08Locale,
  theme: "light" | "dark" = "light",
) {
  await page.setViewportSize(ITEM08_VIEWPORT);
  await page.evaluate(
    async ({ language, theme }) => {
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        appearance: { ...current.appearance, language, theme },
      });
    },
    { language, theme },
  );
  await page.reload();
  await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });
}

export async function measureLegacyCommandMenuGrid(
  panel: Locator,
): Promise<GridLinePair & { rows: unknown[] }> {
  return panel.evaluate((rootEl) => {
    const root = (rootEl.closest("[data-slot='popover-content']") ??
      rootEl.closest("[data-slot='dropdown-menu-content']") ??
      rootEl) as HTMLElement;
    const popoverLeft = root.getBoundingClientRect().left;
    const rel = (value: number) => Math.round(value - popoverLeft);
    const textContentLeft = (el: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().left;
    };
    const rows: { id: string; iconLeft: number; textLeft: number }[] = [];
    for (const item of Array.from(
      root.querySelectorAll('[data-slot="command-item"]'),
    ) as HTMLElement[]) {
      const icon =
        (item.querySelector("svg") as SVGElement | null) ??
        (item.querySelector('[aria-hidden="true"]') as HTMLElement | null);
      const label =
        (item.querySelector("span.truncate") as HTMLElement | null) ??
        (item.querySelector("span.flex-1") as HTMLElement | null) ??
        (Array.from(item.querySelectorAll("span, div")).find(
          (node) => (node.textContent ?? "").trim().length > 0,
        ) as HTMLElement | undefined);
      if (!icon || !label) continue;
      const text = (item.textContent ?? "").replace(/\s+/g, " ").trim();
      rows.push({
        id: text.slice(0, 48),
        iconLeft: rel(icon.getBoundingClientRect().left),
        textLeft: rel(label.getBoundingClientRect().left),
      });
    }
    const projectRows = rows.filter(
      (row) =>
        !row.id.toLowerCase().includes("browse") &&
        !row.id.toLowerCase().includes("no project") &&
        !row.id.includes("新建") &&
        !row.id.includes("No project"),
    );
    const measureFrom = projectRows.length > 0 ? projectRows : rows;
    const iconLeft = Math.min(...measureFrom.map((row) => row.iconLeft));
    const textLeft = Math.min(...measureFrom.map((row) => row.textLeft));
    return { iconLeft, textLeft, rows };
  });
}

export async function burnGridOnPng(
  png: Buffer,
  lines: GridLinePair,
  reference?: GridLinePair,
): Promise<Buffer> {
  return burnGroupedCommandGridLines(png, lines.iconLeft, lines.textLeft, {
    referenceIconLeft: reference?.iconLeft,
    referenceTextLeft: reference?.textLeft,
  });
}

export async function stitchMainPr(
  mainPng: Buffer,
  prPng: Buffer,
): Promise<Buffer> {
  const main = sharp(mainPng);
  const pr = sharp(prPng);
  const [mainMeta, prMeta] = await Promise.all([main.metadata(), pr.metadata()]);
  const height = Math.max(mainMeta.height ?? 0, prMeta.height ?? 0);
  const mainW = mainMeta.width ?? 0;
  const prW = prMeta.width ?? 0;
  const padMain = await main
    .extend({
      top: 0,
      bottom: height - (mainMeta.height ?? 0),
      left: 0,
      right: 0,
      background: { r: 250, g: 250, b: 250, alpha: 1 },
    })
    .png()
    .toBuffer();
  const padPr = await pr
    .extend({
      top: 0,
      bottom: height - (prMeta.height ?? 0),
      left: 0,
      right: 0,
      background: { r: 250, g: 250, b: 250, alpha: 1 },
    })
    .png()
    .toBuffer();
  const gutter = await sharp({
    create: {
      width: 2,
      height,
      channels: 3,
      background: { r: 200, g: 200, b: 200 },
    },
  })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: mainW + prW + 2,
      height,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  })
    .composite([
      { input: padMain, left: 0, top: 0 },
      { input: gutter, left: mainW, top: 0 },
      { input: padPr, left: mainW + 2, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function screenshotPopover(page: Page, target: Locator): Promise<Buffer> {
  const popover = target.locator(
    "xpath=ancestor::*[@data-slot='popover-content' or @data-slot='dropdown-menu-content'][1]",
  );
  if (await popover.count()) {
    return popover.first().screenshot({ animations: "disabled" });
  }
  return target.screenshot({ animations: "disabled" });
}

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

export type PickerId =
  | "project"
  | "workspace"
  | "composer-host"
  | "sidebar-host"
  | "model";

async function setupProjectFixture(page: Page, home: string) {
  await seedProjectPickerGridFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await page.locator('[data-composer-footer-control="project"]').click();
  const beta = /Beta monorepo|Beta/;
  await page.getByRole("option", { name: beta }).click();
}

async function openProjectPicker(page: Page): Promise<Locator> {
  await page.locator('[data-composer-footer-control="project"]').click();
  const prPanel = page.getByTestId("composer-project-picker-panel");
  if (await prPanel.count()) return prPanel;
  return page
    .locator('[data-slot="command"]')
    .filter({ has: page.locator('[data-slot="command-input"]') })
    .first();
}

async function setupWorkspaceFixture(page: Page, home: string) {
  await seedWorkspacePickerFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page
    .getByRole("option", { name: /Workspace fit|工作区 fit/i })
    .click();
}

async function openWorkspacePicker(page: Page): Promise<Locator> {
  await page.locator('[data-composer-footer-control="workspace"]').click();
  const prPanel = page.getByTestId("composer-workspace-picker-panel");
  if (await prPanel.count()) return prPanel;
  return page
    .locator('[data-slot="command"]')
    .filter({ has: page.getByPlaceholder(/Search workspace|搜索工作区|workspace/i) })
    .first();
}

async function openComposerHostPicker(page: Page): Promise<Locator> {
  const prPanel = page.getByTestId("composer-host-picker-panel");
  if (await prPanel.count()) {
    await openRuntimeLocationPicker(page);
    return hostPickerPanel(page);
  }
  await page.locator('[data-composer-footer-control="runtime"]').click();
  return page.locator('[data-slot="dropdown-menu-content"][data-state="open"]').last();
}

async function openSidebarHostPicker(page: Page, flavor: "main" | "pr"): Promise<Locator> {
  if (flavor === "pr") {
    await page.getByTestId("sidebar-local-runtime-row").click();
    return page.getByTestId("sidebar-host-picker-panel");
  }
  await page.locator('[data-composer-footer-control="runtime"]').click();
  return page.locator('[data-slot="dropdown-menu-content"][data-state="open"]').last();
}

async function setupModelFixture(page: Page) {
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "item08-model",
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
}

async function openModelPicker(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
  const prPanel = page.getByTestId("composer-select-menu-panel");
  if (await prPanel.isVisible().catch(() => false)) return prPanel;
  return page.locator('[data-slot="dropdown-menu-content"][data-state="open"]').last();
}

async function measurePickerGrid(
  panel: Locator,
  flavor: "main" | "pr",
): Promise<GridLinePair> {
  if (flavor === "pr" && (await panel.getAttribute("data-testid"))?.includes("picker")) {
    const grid = await measureGroupedCommandMenuGrid(panel);
    return groupedCommandGridLinePositions(grid);
  }
  const legacy = await measureLegacyCommandMenuGrid(panel);
  return { iconLeft: legacy.iconLeft, textLeft: legacy.textLeft };
}

export async function capturePickerHalf(
  appRoot: string,
  flavor: "main" | "pr",
  picker: PickerId,
  language: Item08Locale,
): Promise<{ png: Buffer; lines: GridLinePair; metrics: Record<string, unknown> }> {
  const { page, home, cleanup } = await launchApp({
    language,
    env: {
      BACKCHAT_E2E_APP_ROOT: appRoot,
      BACKCHAT_E2E_VISIBLE: "1",
    },
  });
  try {
    await prepareAppearance(page, language);
    let panel: Locator;
    switch (picker) {
      case "project":
        await setupProjectFixture(page, home);
        panel = await openProjectPicker(page);
        break;
      case "workspace":
        await setupWorkspaceFixture(page, home);
        panel = await openWorkspacePicker(page);
        break;
      case "composer-host":
        await setupWorkspaceFixture(page, home);
        await page.getByTestId("new-chat-button").click();
        panel = await openComposerHostPicker(page);
        break;
      case "sidebar-host":
        await setupWorkspaceFixture(page, home);
        await page.getByTestId("new-chat-button").click();
        panel = await openSidebarHostPicker(page, flavor);
        break;
      case "model":
        await setupModelFixture(page);
        panel = await openModelPicker(page);
        break;
      default:
        throw new Error(`unknown picker ${picker}`);
    }
    await panel.waitFor({ state: "visible", timeout: 15_000 });
    const highlighted = panel.locator(
      '[data-slot="command-item"][data-selected="true"], [role="menuitem"][data-highlighted], [role="option"][data-selected="true"]',
    );
    if (
      picker === "project" ||
      picker === "workspace" ||
      picker === "model" ||
      flavor === "pr"
    ) {
      await expect(highlighted.first()).toBeVisible({ timeout: 10_000 });
    } else {
      await page.waitForTimeout(150);
    }
    const raw = await screenshotPopover(page, panel);
    const lines = await measurePickerGrid(panel, flavor);
    const burned = await burnGridOnPng(raw, lines);
    const highlightCount = await highlighted.count();
    return {
      png: burned,
      lines,
      metrics: {
        picker,
        flavor,
        language,
        lines,
        highlightCount,
        appRoot,
      },
    };
  } finally {
    await cleanup();
  }
}

export async function captureItem08Picker(
  picker: PickerId,
  language: Item08Locale,
  outDir: string,
) {
  await mkdir(outDir, { recursive: true });
  const [main, pr] = await Promise.all([
    capturePickerHalf(MAIN_APP_ROOT, "main", picker, language),
    capturePickerHalf(PR_APP_ROOT, "pr", picker, language),
  ]);
  const base = `${picker}-${language === "zh-CN" ? "zh" : "en"}`;
  await writeFile(join(outDir, `${base}-main.png`), main.png);
  await writeFile(join(outDir, `${base}-pr.png`), pr.png);
  const stitched = await stitchMainPr(main.png, pr.png);
  await writeFile(join(outDir, `${base}-main-pr.png`), stitched);
  await writeFile(
    join(outDir, `${base}.metrics.json`),
    `${JSON.stringify({ main: main.metrics, pr: pr.metrics }, null, 2)}\n`,
    "utf8",
  );
}
