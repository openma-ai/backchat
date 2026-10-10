import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import { burnGroupedCommandGridLines } from "./grouped-command-menu-grid";
import {
  measureMenuInkGrid,
  sampleRowBackgrounds,
  type InkGridPair,
} from "./pr56-item08-ink-grid";
import {
  ITEM08_MODEL_SESSION_ID,
  seedItem08ProjectFixture,
  seedItem08WorkspaceFixture,
} from "./pr56-item08-fixture";
import {
  enableAgent,
  hostPickerPanel,
  injectEvent,
  injectSession,
  launchApp,
  openRuntimeLocationPicker,
} from "./helpers";

const ITEM08_MODEL_CWD = "/tmp/backchat-item08-evidence-cwd";

const execFile = promisify(execFileCallback);

export const ITEM08_EVIDENCE_ROOT =
  process.env.PR56_ITEM08_DIR ??
  "/opt/cursor/artifacts/pr56-evidence-item08-v3";

export const MAIN_APP_ROOT = "/tmp/backchat-main";
export const PR_APP_ROOT = "/workspace";

export const ITEM08_VIEWPORT = { width: 1280, height: 800 };

export type Item08Locale = "en" | "zh-CN";
export type CapturePhase = "open" | "roving";

export type PickerId =
  | "project"
  | "workspace"
  | "composer-host"
  | "sidebar-host"
  | "model";

let cachedMainSha: string | null = null;
let cachedPrSha: string | null = null;

export async function resolveBuildSha(appRoot: string): Promise<string> {
  if (appRoot === MAIN_APP_ROOT && cachedMainSha) return cachedMainSha;
  if (appRoot === PR_APP_ROOT && cachedPrSha) return cachedPrSha;
  const { stdout } = await execFile("git", [
    "-C",
    appRoot,
    "rev-parse",
    "--short",
    "HEAD",
  ]);
  const sha = stdout.trim();
  if (appRoot === MAIN_APP_ROOT) cachedMainSha = sha;
  if (appRoot === PR_APP_ROOT) cachedPrSha = sha;
  return sha;
}

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

async function focusAppWindow(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    const win =
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows().find((w) => w.isVisible()) ??
      BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (!win.isVisible()) win.show();
    win.focus();
  });
}

async function waitForPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.waitForTimeout(100);
}

async function settleOpenState(page: Page, app: ElectronApplication) {
  await page.bringToFront();
  await focusAppWindow(app);
  await waitForPaint(page);
}

async function settleRovingState(page: Page, app: ElectronApplication, panel: Locator) {
  await page.bringToFront();
  await focusAppWindow(app);
  const input = panel.locator(
    '[data-slot="command-input"], [cmdk-input], input[type="text"]',
  );
  if (await input.count()) {
    await input.first().focus();
  } else {
    await panel.focus().catch(() => undefined);
  }
  await page.keyboard.press("ArrowDown");
  await waitForPaint(page);
}

async function burnViewportGrid(png: Buffer, lines: InkGridPair): Promise<Buffer> {
  return burnGroupedCommandGridLines(png, lines.iconLeft, lines.textLeft);
}

async function addCaptionStrip(png: Buffer, caption: string): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const stripH = 28;
  const svg = Buffer.from(
    `<svg width="${width}" height="${stripH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="8" y="19" font-family="ui-monospace, monospace" font-size="13" fill="#f9fafb">${caption.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>
    </svg>`,
  );
  const strip = await sharp(svg).png().toBuffer();
  return sharp({
    create: {
      width,
      height: height + stripH,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  })
    .composite([{ input: png, top: 0, left: 0 }, { input: strip, top: height, left: 0 }])
    .png()
    .toBuffer();
}

async function stitchMainPr(
  mainPng: Buffer,
  prPng: Buffer,
  caption: string,
): Promise<Buffer> {
  const [mainMeta, prMeta] = await Promise.all([
    sharp(mainPng).metadata(),
    sharp(prPng).metadata(),
  ]);
  const height = Math.max(mainMeta.height ?? 0, prMeta.height ?? 0);
  const mainW = mainMeta.width ?? 0;
  const prW = prMeta.width ?? 0;
  const pad = async (buf: Buffer, meta: sharp.Metadata) =>
    sharp(buf)
      .extend({
        top: 0,
        bottom: height - (meta.height ?? 0),
        left: 0,
        right: 0,
        background: { r: 250, g: 250, b: 250 },
      })
      .png()
      .toBuffer();
  const [padMain, padPr] = await Promise.all([
    pad(mainPng, mainMeta),
    pad(prPng, prMeta),
  ]);
  const gutter = await sharp({
    create: {
      width: 2,
      height,
      channels: 3,
      background: { r: 160, g: 160, b: 160 },
    },
  })
    .png()
    .toBuffer();
  const stitched = await sharp({
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
  return addCaptionStrip(stitched, caption);
}

async function renderNoMainEquivalent(
  sha: string,
  locale: Item08Locale,
  phase: CapturePhase,
): Promise<Buffer> {
  const label =
    locale === "zh-CN"
      ? `origin/main (${sha})：无侧栏主机菜单`
      : `origin/main (${sha}): no sidebar host menu`;
  const hint =
    locale === "zh-CN"
      ? "最接近的主线表面：composer-host（见 composer-host-*-main）"
      : "Closest main surface: composer-host (see composer-host-*-main)";
  const svg = Buffer.from(
    `<svg width="1280" height="800" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f3f4f6"/>
      <text x="64" y="120" font-family="system-ui, sans-serif" font-size="28" fill="#111827">${label}</text>
      <text x="64" y="170" font-family="system-ui, sans-serif" font-size="18" fill="#374151">${hint}</text>
      <text x="64" y="220" font-family="ui-monospace, monospace" font-size="16" fill="#6b7280">phase: ${phase}</text>
    </svg>`,
  );
  const base = await sharp(svg).png().toBuffer();
  return addCaptionStrip(
    base,
    `origin/main ${sha} · sidebar-host N/A · ${phase}`,
  );
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

async function setupProjectFixture(page: Page, home: string) {
  await seedItem08ProjectFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: /Beta monorepo|Beta/ }).click();
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
  await seedItem08WorkspaceFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: /Workspace fit|工作区/ }).click();
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
  if (await page.getByTestId("composer-host-picker-panel").count()) {
    await openRuntimeLocationPicker(page);
    return hostPickerPanel(page);
  }
  await page.locator('[data-composer-footer-control="runtime"]').click();
  return page.locator('[data-slot="dropdown-menu-content"][data-state="open"]').last();
}

async function openSidebarHostPicker(page: Page): Promise<Locator> {
  await page.getByTestId("sidebar-local-runtime-row").click();
  return page.getByTestId("sidebar-host-picker-panel");
}

async function setupModelFixture(page: Page) {
  await enableAgent(page, "codex-acp");
  await injectSession(page, {
    sessionId: ITEM08_MODEL_SESSION_ID,
    agentId: "codex-acp",
    cwd: ITEM08_MODEL_CWD,
  });
  await injectEvent(page, {
    type: "session.event",
    session_id: ITEM08_MODEL_SESSION_ID,
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

async function openModelSubmenuPr(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  const menu = page.getByRole("menu").last();
  await menu.getByRole("menuitem", { name: /Model|模型/ }).first().hover();
  await page.waitForTimeout(200);
  const prPanel = page.getByTestId("composer-select-menu-panel");
  await expect(prPanel).toBeVisible({ timeout: 10_000 });
  return prPanel;
}

async function openModelSubmenuMain(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  const menu = page.getByRole("menu").last();
  const modelEntry = menu.getByRole("menuitem", { name: /Model|模型/ }).first();
  await modelEntry.hover();
  await page.waitForTimeout(250);
  const modelRow = page.getByRole("menuitem", { name: /openai-codex model 0/i });
  await expect(modelRow).toBeVisible({ timeout: 10_000 });
  const subSlot = modelRow.locator(
    "xpath=ancestor::*[@data-slot='dropdown-menu-sub-content'][1]",
  );
  if (await subSlot.count()) return subSlot;
  return modelRow.locator("xpath=ancestor::*[@role='menu'][1]");
}

async function panelKind(
  flavor: "main" | "pr",
  picker: PickerId,
  panel: Locator,
): Promise<string> {
  return panel.evaluate((el, args) => {
    if (args.picker !== "model") {
      if (el.getAttribute("data-testid")?.includes("picker")) return "GroupedCommandMenu";
      if (el.closest("[data-slot='popover-content']")) return "CommandPopover";
      return "DropdownMenuContent";
    }
    if (args.flavor === "pr") return "GroupedCommandMenu";
    if (el.getAttribute("data-slot") === "dropdown-menu-sub-content") {
      return "DropdownMenuSubContent";
    }
    if (el.querySelector('[data-slot="command-input"]')) {
      return "CommandMenu (unexpected on main)";
    }
    return "DropdownMenuSubContent";
  }, { flavor, picker });
}

export async function capturePickerHalf(
  appRoot: string,
  flavor: "main" | "pr",
  picker: PickerId,
  language: Item08Locale,
  phase: CapturePhase,
): Promise<{
  png: Buffer;
  lines: InkGridPair | null;
  metrics: Record<string, unknown>;
  sha: string;
}> {
  const sha = await resolveBuildSha(appRoot);

  if (picker === "sidebar-host" && flavor === "main") {
    const png = await renderNoMainEquivalent(sha, language, phase);
    return {
      png,
      lines: null,
      sha,
      metrics: {
        picker,
        flavor,
        language,
        phase,
        sha,
        mainEquivalent: "none (see composer-host)",
        lines: null,
      },
    };
  }

  const { page, home, app, cleanup } = await launchApp({
    language,
    env: {
      BACKCHAT_E2E_APP_ROOT: appRoot,
      BACKCHAT_E2E_VISIBLE: "1",
    },
  });
  try {
    await prepareAppearance(page, language);
    await focusAppWindow(app);

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
        panel = await openSidebarHostPicker(page);
        break;
      case "model":
        await setupModelFixture(page);
        panel =
          flavor === "pr"
            ? await openModelSubmenuPr(page)
            : await openModelSubmenuMain(page);
        break;
      default:
        throw new Error(`unknown picker ${picker}`);
    }

    await panel.waitFor({ state: "visible", timeout: 15_000 });

    if (phase === "open") {
      await settleOpenState(page, app);
    } else {
      await settleRovingState(page, app, panel);
    }

    const ink = await measureMenuInkGrid(panel);
    const backgrounds = await sampleRowBackgrounds(panel);
    const kind = await panelKind(flavor, picker, panel);
    const rawWindow = await page.screenshot({ animations: "disabled" });
    const burned = await burnViewportGrid(rawWindow, {
      iconLeft: ink.iconLeft,
      textLeft: ink.textLeft,
    });
    const captioned = await addCaptionStrip(
      burned,
      `${flavor === "main" ? "origin/main" : "PR"} ${sha} · ${picker} · ${phase} · ${language}`,
    );

    const highlighted = panel.locator(
      '[data-slot="command-item"][data-selected="true"], [role="menuitem"][data-highlighted]',
    );

    return {
      png: captioned,
      lines: { iconLeft: ink.iconLeft, textLeft: ink.textLeft },
      sha,
      metrics: {
        picker,
        flavor,
        language,
        phase,
        sha,
        appRoot,
        sessionId: picker === "model" ? ITEM08_MODEL_SESSION_ID : undefined,
        viewport: ITEM08_VIEWPORT,
        panelKind: kind,
        lines: ink,
        highlightCount: await highlighted.count().catch(() => 0),
        backgrounds,
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
  const locale = language === "zh-CN" ? "zh" : "en";
  const base = `${picker}-${locale}`;

  for (const phase of ["open", "roving"] as const) {
    const main = await capturePickerHalf(
      MAIN_APP_ROOT,
      "main",
      picker,
      language,
      phase,
    );
    const pr = await capturePickerHalf(PR_APP_ROOT, "pr", picker, language, phase);

    const mainName = `${base}-${phase}-main-${main.sha}.png`;
    const prName = `${base}-${phase}-pr-${pr.sha}.png`;
    const stitchName = `${base}-${phase}-main-pr-${main.sha}-vs-${pr.sha}.png`;

    await writeFile(join(outDir, mainName), main.png);
    await writeFile(join(outDir, prName), pr.png);
    const stitched = await stitchMainPr(
      main.png,
      pr.png,
      `main ${main.sha} | PR ${pr.sha} · ${picker} · ${phase} · ${locale}`,
    );
    await writeFile(join(outDir, stitchName), stitched);
    await writeFile(
      join(outDir, `${base}-${phase}.metrics.json`),
      `${JSON.stringify({ main: main.metrics, pr: pr.metrics }, null, 2)}\n`,
      "utf8",
    );
  }
}

export async function writeHighlightTokenDoc(outDir: string) {
  const doc = `# Item 08 — open highlight: intentional PR change (not parity)

## Intended product difference

| Moment | \`origin/main\` | **PR (#56)** |
|--------|-----------------|--------------|
| **Menu just opened** (checked / current row) | \`data-selected\` row gets \`--control-bg-hover\` (8% fg wash) via \`.app-select-focus[data-selected="true"]\` | Checked row stays **transparent**; **checkmark only** (\`grouped-command-menu\` checked rules) |
| **Hover** or **ArrowDown/Up** (roving) | Same hover token on focused row | Wash on **non-checked** \`data-selected\` rows when \`data-roving-active="true"\`; checked row still checkmark-only |

This follows the earlier rule: **do not give the checked row a permanent selection wash**; keyboard/hover move the wash to the focused row. PR extends that to **open**: the current value is identified by the checkmark, not a gray fill.

## Shared tokens (light & dark)

\`\`\`1681:1683:src/renderer/src/styles/index.css
  --interaction-bg-hover: color-mix(in srgb, var(--fg) 8%, transparent);
  --control-bg-hover: var(--interaction-bg-hover);
\`\`\`

PR checked-at-open (transparent):

\`\`\`2439:2448:src/renderer/src/styles/index.css
/* Current value: checkmark only — never the gray hover/keyboard wash. */
.grouped-command-menu [data-slot="command-item"][data-checked="true"],
...
\`\`\`

Main open wash on selected cmdk row:

\`\`\`394:401:src/renderer/src/styles/index.css
.app-select-focus:is(:focus, [data-highlighted], [data-selected="true"]):not(
    [data-checked="true"],
    [data-state="checked"]
  ),
...
  background: var(--control-bg-hover);
\`\`\`

(Checked rows on main are also transparent when \`data-checked\` applies; open-on-current uses \`data-selected\` on the value row.)

## Evidence shots

- \`*-open-*\`: no arrow keys after open (autofocus only).
- \`*-roving-*\`: one \`ArrowDown\` after open to show keyboard wash on the focused row.
`;
  await writeFile(join(outDir, "highlight-token.md"), doc, "utf8");
}
