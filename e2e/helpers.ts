/**
 * Shared Playwright + Electron launch helpers. The fixture in `fixtures.ts`
 * uses these helpers to give every test a fresh Electron process. Specs that
 * need a custom home or a deliberate relaunch can call `launchAppWithHome`
 * directly. The helper:
 *   - points electron at the built main bundle (./out/main/index.js)
 *   - sets BACKCHAT_TEST_HOOKS=1 so main/preload register test IPC
 *   - returns the ElectronApplication + first BrowserWindow Page
 *   - keeps the app window hidden unless BACKCHAT_E2E_VISIBLE=1 is set
 *
 * The build step (`pnpm build`) must have run before `pnpm test:e2e`.
 * package.json wires this as a prereq; in CI we always re-build first.
 */
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TestBridge,
  type ExportSessionFilesResult,
  type PersistedSessionFixture,
} from "./test-bridge";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env["BACKCHAT_E2E_APP_ROOT"]
  ? resolve(process.env["BACKCHAT_E2E_APP_ROOT"])
  : join(here, "..");

interface LaunchAppOptions {
  language?: "en" | "zh-CN";
  env?: Record<string, string>;
}

export async function launchApp(options: LaunchAppOptions = {}): Promise<{
  app: ElectronApplication;
  page: Page;
  home: string;
  cleanup: () => Promise<void>;
}> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const home = await mkdtemp(join(tmpdir(), "backchat-e2e-"));
    try {
      return await launchAppWithHome(home, options);
    } catch (error) {
      lastError = error;
      if (process.env["BACKCHAT_KEEP_E2E_HOME"] !== "1") {
        await rm(home, { recursive: true, force: true });
      }
    }
  }
  throw lastError ?? new Error("Electron E2E launch failed");
}

export async function launchAppWithHome(
  home: string,
  options: LaunchAppOptions = {},
): Promise<{
  app: ElectronApplication;
  page: Page;
  home: string;
  cleanup: () => Promise<void>;
}> {
  const app = await electron.launch({
    args: [join(repoRoot, "out/main/index.js")],
    env: {
      ...process.env,
      ...(options.env ?? {}),
      BACKCHAT_TEST_HOOKS: "1",
      // Live ACP capability probes are useful in production, but they make
      // relaunch/persistence E2Es depend on a configured agent process.
      BACKCHAT_E2E_SKIP_AGENT_WARMUP: "1",
      BACKCHAT_HOME: home,
      // `openmaRoot()` honours BACKCHAT_HOME whenever BACKCHAT_TEST_HOOKS is set,
      // so the SQLite store opens under this per-test home. Nothing here reads or
      // writes the developer's real ~/.oma.
      NODE_ENV: "test",
    },
  });
  const page = await app.firstWindow();
  try {
    await page.addStyleTag({
      content: `
        *,
        *::before,
        *::after {
          animation-delay: 0s !important;
          animation-duration: 0s !important;
          scroll-behavior: auto !important;
          transition-delay: 0s !important;
          transition-duration: 0s !important;
        }
      `,
    });
    // Wait on a locale-independent marker, then force English for the legacy
    // E2E suite unless a localization test explicitly requests Chinese.
    await waitForRendererReady(page);
    await page.evaluate(async (language) => {
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        appearance: { ...current.appearance, language },
      });
    }, options.language ?? "en");
  } catch (e) {
    await closeApp(app).catch(() => undefined);
    throw e;
  }
  return {
    app,
    page,
    home,
    cleanup: async () => {
      await closeApp(app).catch(() => undefined);
      if (process.env["BACKCHAT_KEEP_E2E_HOME"] !== "1") {
        await rm(home, { recursive: true, force: true });
      }
    },
  };
}

export async function closeApp(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  const exited = new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
  });
  await Promise.race([
    app.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    }),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 500);
      timer.unref?.();
    }),
  ]).catch(() => undefined);
  const didExit = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2_000);
      timer.unref?.();
    }),
  ]);
  if (!didExit) {
    proc.kill("SIGKILL");
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        timer.unref?.();
      }),
    ]);
  }
}

/** Refresh renderer-owned query caches after a test changes settings through
 * the public IPC API. Real settings screens invalidate those queries
 * themselves; direct E2E setup intentionally bypasses that UI lifecycle. */
export async function reloadRenderer(page: Page): Promise<void> {
  await page.reload();
  await waitForRendererReady(page);
}

/** Enable one agent override and reload so renderer-owned settings queries
 * observe it. Fresh E2E homes intentionally start with no enabled agents. */
export async function enableAgent(page: Page, agentId: string): Promise<void> {
  const changed = await page.evaluate(async (id) => {
    const current = await window.backchat.settingsGet();
    const existing = current.agents.find((agent) => agent.id === id);
    if (existing?.enabled) return false;
    await window.backchat.settingsPatch({
      agents: existing
        ? current.agents.map((agent) => (
            agent.id === id ? { ...agent, enabled: true } : agent
          ))
        : [...current.agents, { id, enabled: true, env: [] }],
    });
    return true;
  }, agentId);
  if (changed) await reloadRenderer(page);
}

/** Electron can occasionally create its first window before the renderer has
 * mounted after a DB rebuild. One bounded reload keeps startup assertions
 * deterministic while still failing when the renderer cannot boot. */
async function waitForRendererReady(page: Page): Promise<void> {
  const marker = page.getByTestId("new-chat-button");
  try {
    await marker.waitFor({ timeout: 15_000 });
  } catch (error) {
    if (page.isClosed()) throw error;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
    await marker.waitFor({ timeout: 15_000 });
  }
}

/** Open a persisted session through the same collapsed project grouping users
 * see in the sidebar. Persisted projects intentionally start collapsed. */
export async function openPersistedSession(
  page: Page,
  title: string,
  projectLabel?: string,
): Promise<Locator> {
  const navigation = page.getByRole("navigation");
  const session = navigation.getByRole("button", { name: title, exact: true });
  if (!(await session.isVisible())) {
    if (projectLabel) {
      const project = navigation.getByRole("button", {
        name: projectLabel,
        exact: true,
      });
      if (await project.isVisible()) await project.click();
    }
  }
  if (!(await session.isVisible())) {
    // Project labels are presentation data (and managed sessions use a
    // generated cwd), so fall back to expanding every collapsed project.
    const collapsedProjects = navigation.locator('button[aria-expanded="false"]');
    for (let index = 0; index < await collapsedProjects.count(); index += 1) {
      await collapsedProjects.nth(index).click();
      if (await session.isVisible()) break;
    }
  }
  await session.waitFor({ state: "visible" });
  await session.click();
  return session;
}

export async function openCommandPalette(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const palette = page.getByRole("dialog");
  await palette.waitFor({ state: "visible" });
  return palette;
}

export async function openBrowserPanel(page: Page): Promise<void> {
  const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
  if (!(await closeSidePanel.isVisible())) {
    await page.getByRole("button", { name: "Open side panel" }).click();
  }
  await closeSidePanel.waitFor({ state: "visible" });
  const browserTab = page.getByRole("button", { name: /^Browser\b/ }).first();
  if (await browserTab.isVisible()) {
    await browserTab.click();
  } else {
    // The empty side panel now exposes browser as the user-facing
    // “Website” quick tile; an existing tab still uses the Browser label.
    await page.getByRole("button", { name: /^Website\b/ }).click();
  }
  const browser = page.locator('[data-browser-visible="true"]');
  await browser.waitFor({ state: "visible" });
  const webview = browser.locator("webview");
  await webview.waitFor({ state: "attached" });
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  await webview.evaluate((element) =>
    (element as HTMLElement & { loadURL(url: string): Promise<void> }).loadURL(
      "about:blank#backchat-e2e",
    ),
  );
  await webview.waitFor({ state: "visible" });
}

export async function waitForRunnableHarness(page: Page): Promise<Locator> {
  const runButton = page.getByRole("button", {
    name: /Run on Local with .* using/,
  });
  await runButton.waitFor({ state: "visible", timeout: 15_000 });
  return runButton;
}

/** Push a `session.ready` event via the test IPC bridge so a fresh
 *  SessionRow shows up in the sidebar + becomes active in the chat
 *  pane. Returns the session id we synthesized. */
export async function injectSession(
  page: Page,
  opts: {
    sessionId?: string;
    agentId?: string;
    cwd?: string;
    supportsSteering?: boolean;
  } = {},
): Promise<string> {
  const sessionId = opts.sessionId ?? `e2e-${Math.random().toString(36).slice(2, 8)}`;
  const agentId = opts.agentId ?? "claude-acp";
  const cwd = opts.cwd ?? "/tmp/backchat-test";
  await new TestBridge(page).injectSessionRow({
    session_id: sessionId,
    agent_id: agentId,
    cwd,
    ...(opts.supportsSteering === undefined
      ? {}
      : { supports_steering: opts.supportsSteering }),
  });
  const sessionButton = page.getByRole("button", {
    name: `${agentId} · ${sessionId.slice(0, 6)}`,
  });
  if (!(await sessionButton.isVisible())) {
    const projectButton = page.getByRole("button", {
      name: basename(cwd),
      exact: true,
    });
    if ((await projectButton.getAttribute("aria-expanded")) !== "true") {
      await projectButton.click();
    }
  }
  await sessionButton.click();
  return sessionId;
}

/** Push a raw session.event payload through. The renderer's
 *  sessionStore.apply consumes it just like a real ACP child push. */
export async function injectEvent(
  page: Page,
  msg: { type: string; [k: string]: unknown },
): Promise<void> {
  await new TestBridge(page).injectSessionEvent(msg);
}

export type AvailableCommandFixture = {
  name: string;
  description?: string;
  input?: { hint?: string };
  kind?: string;
  _meta?: Record<string, unknown>;
};

/** Seed the active session's slash-command catalogue through the ACP-shaped
 * event bridge. Keeping this setup in one helper makes slash E2Es resilient
 * when the event envelope changes. */
export async function injectAvailableCommands(
  page: Page,
  sessionId: string,
  availableCommands: AvailableCommandFixture[],
): Promise<void> {
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "e2e-command-catalogue",
    event: {
      sessionUpdate: "available_commands_update",
      availableCommands,
    },
  });
}

export async function persistSessionFixture(
  page: Page,
  fixture: PersistedSessionFixture,
): Promise<void> {
  await new TestBridge(page).persistSessionFixture(fixture);
}

export async function exportSessionFiles(
  page: Page,
  opts: { overwrite?: boolean } = {},
): Promise<ExportSessionFilesResult> {
  return new TestBridge(page).exportSessionFiles(opts);
}
