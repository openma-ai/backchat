/**
 * Shared Playwright + Electron launch helpers. Every spec imports
 * `launchApp` to get a fresh Electron process. The helper:
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
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

export async function launchApp(options: { language?: "en" | "zh-CN" } = {}): Promise<{
  app: ElectronApplication;
  page: Page;
  home: string;
  cleanup: () => Promise<void>;
}> {
  return launchAppWithHome(
    await mkdtemp(join(tmpdir(), "backchat-e2e-")),
    options,
  );
}

export async function launchAppWithHome(
  home: string,
  options: { language?: "en" | "zh-CN" } = {},
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
      BACKCHAT_TEST_HOOKS: "1",
      BACKCHAT_HOME: home,
      // Skip the renderer-side persistence load so each test starts
      // with an empty sidebar (the SQLite store still mounts at
      // ~/.openma/sessions.db; opt out of the seedPersisted call
      // would be cleaner, but for now we just tolerate any pre-existing
      // rows — tests assert on what they inject, not on totals).
      NODE_ENV: "test",
    },
  });
  const page = await app.firstWindow();
  try {
    // Wait on a locale-independent marker, then force English for the legacy
    // E2E suite unless a localization test explicitly requests Chinese.
    await page.getByTestId("new-chat-button").waitFor({
      timeout: 30_000,
    });
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
  await page.getByTestId("new-chat-button").waitFor({ timeout: 30_000 });
}

/** Open a persisted session through the same collapsed project grouping users
 * see in the sidebar. Persisted projects intentionally start collapsed. */
export async function openPersistedSession(
  page: Page,
  title: string,
  projectLabel: string,
): Promise<Locator> {
  const navigation = page.getByRole("navigation");
  const project = navigation.getByRole("button", {
    name: projectLabel,
    exact: true,
  });
  if ((await project.getAttribute("aria-expanded")) !== "true") {
    await project.click();
  }
  const session = navigation.getByRole("button", { name: title, exact: true });
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
    await page.getByRole("button", { name: "Open side chat" }).click();
  }
  await closeSidePanel.waitFor({ state: "visible" });
  await page.getByRole("button", { name: /^Browser\b/ }).click();
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
  opts: { agentId?: string; cwd?: string } = {},
): Promise<string> {
  const sessionId = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  const agentId = opts.agentId ?? "claude-acp";
  const cwd = opts.cwd ?? "/tmp/backchat-test";
  await page.evaluate(
    async ({ sessionId, agentId, cwd }) => {
      // @ts-expect-error — test bridge typed in preload/index.ts
      await window.__backchatTest.injectSessionRow({
        session_id: sessionId,
        agent_id: agentId,
        cwd,
      });
    },
    { sessionId, agentId, cwd },
  );
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
  await page.evaluate(async (m) => {
    // @ts-expect-error — test bridge
    await window.__backchatTest.injectSessionEvent(m);
  }, msg);
}

export async function persistSessionFixture(
  page: Page,
  fixture: {
    sessionId: string;
    agentId?: string;
    cwd?: string;
    acpSessionId?: string;
    title?: string;
    events: Array<{ type: string; data: unknown; ts?: number }>;
  },
): Promise<void> {
  await page.evaluate(async (p) => {
    // @ts-expect-error — test bridge
    await window.__backchatTest.persistSessionFixture(p);
  }, fixture);
}

export async function exportSessionFiles(
  page: Page,
  opts: { overwrite?: boolean } = {},
): Promise<{
  sessions: Array<{
    sessionId: string;
    eventCount: number;
    transcriptPath: string;
    metadataPath: string;
    skipped: boolean;
  }>;
  pairs: Array<{ pairId: string; metadataPath: string; skipped: boolean }>;
}> {
  return page.evaluate(async (p) => {
    // @ts-expect-error — test bridge
    return window.__backchatTest.exportSessionFiles(p);
  }, opts);
}
