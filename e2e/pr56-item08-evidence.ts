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

const execFile = promisify(execFileCallback);

export const ITEM08_EVIDENCE_ROOT =
  process.env.PR56_ITEM08_DIR ??
  "/opt/cursor/artifacts/pr56-evidence-item08-v2";

export const MAIN_APP_ROOT = "/tmp/backchat-main";
export const PR_APP_ROOT = "/workspace";

export const ITEM08_VIEWPORT = { width: 1280, height: 800 };
export const ITEM08_SIDEBAR_VIEWPORT = { width: 1280, height: 960 };

export type Item08Locale = "en" | "zh-CN";

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
  viewport = ITEM08_VIEWPORT,
) {
  await page.setViewportSize(viewport);
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
  await page.waitForTimeout(80);
}

async function activateMenuFocus(page: Page, panel: Locator) {
  await page.bringToFront();
  const input = panel.locator(
    '[data-slot="command-input"], [cmdk-input], input[type="text"]',
  );
  if (await input.count()) {
    await input.first().focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
  } else {
    const selected = panel.locator(
      '[data-slot="command-item"][data-selected="true"], [role="menuitem"][data-highlighted]',
    );
    if (await selected.count()) {
      await selected.first().hover({ force: true });
    }
  }
  await waitForPaint(page);
}

async function burnViewportGrid(
  png: Buffer,
  lines: InkGridPair,
): Promise<Buffer> {
  return burnGroupedCommandGridLines(png, lines.iconLeft, lines.textLeft);
}

async function addCaptionStrip(
  png: Buffer,
  caption: string,
): Promise<Buffer> {
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
  const main = sharp(mainPng);
  const pr = sharp(prPng);
  const [mainMeta, prMeta] = await Promise.all([main.metadata(), pr.metadata()]);
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
  prPicker: PickerId,
): Promise<Buffer> {
  const label =
    locale === "zh-CN"
      ? `origin/main (${sha})：无侧栏主机菜单`
      : `origin/main (${sha}): no sidebar host menu`;
  const hint =
    locale === "zh-CN"
      ? `最接近的主线表面：composer-host（见 composer-host-${locale === "zh-CN" ? "zh" : "en"}-main）`
      : `Closest main surface: composer-host (see composer-host-${locale === "zh-CN" ? "zh" : "en"}-main-${sha}.png)`;
  const svg = Buffer.from(
    `<svg width="1280" height="800" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f3f4f6"/>
      <text x="64" y="120" font-family="system-ui, sans-serif" font-size="28" fill="#111827">${label}</text>
      <text x="64" y="170" font-family="system-ui, sans-serif" font-size="18" fill="#374151">${hint}</text>
      <text x="64" y="220" font-family="ui-monospace, monospace" font-size="16" fill="#6b7280">PR picker: ${prPicker}</text>
    </svg>`,
  );
  return sharp(svg).png().toBuffer();
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
  await seedProjectPickerGridFixture(page, home);
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
  await seedWorkspacePickerFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: /Workspace fit|工作区 fit/i }).click();
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

async function openModelSubmenu(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  const menu = page.getByRole("menu").last();
  const modelEntry = menu.getByRole("menuitem", { name: /Model|模型/ }).first();
  await modelEntry.hover();
  await page.waitForTimeout(200);
  const prPanel = page.getByTestId("composer-select-menu-panel");
  await expect(prPanel).toBeVisible({ timeout: 10_000 });
  await expect(
    prPanel.locator('[data-slot="command-item"]').filter({
      hasText: /openai-codex model 0/i,
    }),
  ).toBeVisible({ timeout: 10_000 });
  return prPanel;
}

async function openModelSubmenuMain(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  const menu = page.getByRole("menu").last();
  const modelEntry = menu.getByRole("menuitem", { name: /Model|模型/ }).first();
  await modelEntry.hover();
  await page.waitForTimeout(200);
  const sub = page
    .locator('[data-slot="dropdown-menu-sub-content"]')
    .filter({ hasText: /openai-codex model 0/i })
    .first();
  await expect(sub).toBeVisible({ timeout: 10_000 });
  return sub;
}

export async function capturePickerHalf(
  appRoot: string,
  flavor: "main" | "pr",
  picker: PickerId,
  language: Item08Locale,
): Promise<{
  png: Buffer;
  lines: InkGridPair | null;
  metrics: Record<string, unknown>;
  sha: string;
}> {
  const sha = await resolveBuildSha(appRoot);
  const viewport =
    picker === "sidebar-host" && flavor === "pr"
      ? ITEM08_SIDEBAR_VIEWPORT
      : ITEM08_VIEWPORT;

  if (picker === "sidebar-host" && flavor === "main") {
    const png = await addCaptionStrip(
      await renderNoMainEquivalent(sha, language, picker),
      `origin/main ${sha} · sidebar-host N/A`,
    );
    return {
      png,
      lines: null,
      sha,
      metrics: {
        picker,
        flavor,
        language,
        sha,
        mainEquivalent: "none (see composer-host)",
        lines: null,
        highlightCount: 0,
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
    await prepareAppearance(page, language, "light", viewport);
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
            ? await openModelSubmenu(page)
            : await openModelSubmenuMain(page);
        break;
      default:
        throw new Error(`unknown picker ${picker}`);
    }

    await panel.waitFor({ state: "visible", timeout: 15_000 });
    const highlighted =
      picker === "model"
        ? panel
            .locator(
              '[data-slot="command-item"], [data-slot="dropdown-menu-item"], [role="menuitem"]',
            )
            .filter({ hasText: /openai-codex model 0/i })
            .first()
        : panel.locator(
            '[data-slot="command-item"][data-selected="true"], [role="menuitem"][data-highlighted]',
          );
    await expect(highlighted).toBeVisible({ timeout: 10_000 });
    await activateMenuFocus(page, panel);
    await focusAppWindow(app);
    await waitForPaint(page);

    const ink = await measureMenuInkGrid(panel);
    const backgrounds = await sampleRowBackgrounds(panel);
    const rawWindow = await page.screenshot({ animations: "disabled" });
    const burned = await burnViewportGrid(rawWindow, {
      iconLeft: ink.iconLeft,
      textLeft: ink.textLeft,
    });
    const captioned = await addCaptionStrip(
      burned,
      `${flavor === "main" ? "origin/main" : "PR"} ${sha} · ${picker} · ${language} · ${viewport.width}×${viewport.height}`,
    );

    return {
      png: captioned,
      lines: { iconLeft: ink.iconLeft, textLeft: ink.textLeft },
      sha,
      metrics: {
        picker,
        flavor,
        language,
        sha,
        appRoot,
        viewport,
        lines: ink,
        highlightCount: await highlighted.count(),
        backgrounds,
        checkmarkOnlyPolicy: "see highlight-token.md",
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
  const main = await capturePickerHalf(MAIN_APP_ROOT, "main", picker, language);
  const pr = await capturePickerHalf(PR_APP_ROOT, "pr", picker, language);
  const locale = language === "zh-CN" ? "zh" : "en";
  const base = `${picker}-${locale}`;
  const mainName = `${base}-main-${main.sha}.png`;
  const prName = `${base}-pr-${pr.sha}.png`;
  const stitchName = `${base}-main-pr-${main.sha}-vs-${pr.sha}.png`;

  await writeFile(join(outDir, mainName), main.png);
  await writeFile(join(outDir, prName), pr.png);
  const stitched = await stitchMainPr(
    main.png,
    pr.png,
    `main ${main.sha} | PR ${pr.sha} · ${picker} · ${locale}`,
  );
  await writeFile(join(outDir, stitchName), stitched);
  await writeFile(
    join(outDir, `${base}.metrics.json`),
    `${JSON.stringify({ main: main.metrics, pr: pr.metrics }, null, 2)}\n`,
    "utf8",
  );

  if (picker === "project" && language === "en") {
    await writeFile(
      join(ITEM08_EVIDENCE_ROOT, `main-project-picker-open-${main.sha}.png`),
      main.png,
    );
    await writeFile(
      join(ITEM08_EVIDENCE_ROOT, `pr-project-picker-open-${pr.sha}.png`),
      pr.png,
    );
  }
}

export async function writeHighlightTokenDoc(outDir: string) {
  const doc = `# Grouped command menu — open highlight tokens (light & dark)

Checked rows at open use **checkmark-only** background policy; keyboard/hover wash uses shared tokens in both themes.

\`\`\`1681:1683:src/renderer/src/styles/index.css
  --interaction-bg-hover: color-mix(in srgb, var(--fg) 8%, transparent);
  --interaction-bg-active: var(--interaction-bg-hover);
  --control-bg-hover: var(--interaction-bg-hover);
\`\`\`

\`\`\`2439:2465:src/renderer/src/styles/index.css
/* Current value: checkmark only — never the gray hover/keyboard wash. */
.grouped-command-menu [data-slot="command-item"][data-checked="true"],
...
.grouped-command-menu[data-roving-active="true"]
  [data-slot="command-item"][data-selected="true"]:not([data-checked="true"]) {
  background: var(--control-bg-hover) !important;
  color: var(--control-fg-active);
}
\`\`\`

Legacy \`Command\` popovers on \`origin/main\` use the same \`--control-bg-hover\` via \`.app-select-focus\` (no separate light/dark hover token).

E2E asserts checked workspace/local rows stay visually transparent while selected:
\`e2e/capture-workspace-picker-selected.spec.ts\` (\`background-color: rgba(0, 0, 0, 0)\`).
`;
  await writeFile(join(outDir, "highlight-token.md"), doc, "utf8");
}
