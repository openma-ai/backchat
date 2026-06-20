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
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

export async function launchApp(): Promise<{
  app: ElectronApplication;
  page: Page;
  home: string;
  cleanup: () => Promise<void>;
}> {
  return launchAppWithHome(await mkdtemp(join(tmpdir(), "backchat-e2e-")));
}

export async function launchAppWithHome(home: string): Promise<{
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
  // Wait for the React tree to mount — the composer textarea is the
  // universal shell anchor, but its placeholder depends on whether the
  // app restored an existing chat or opened to the empty state.
  await page.waitForSelector("textarea", {
    timeout: 10_000,
  });
  return {
    app,
    page,
    home,
    cleanup: async () => {
      await app.close().catch(() => undefined);
      if (process.env["BACKCHAT_KEEP_E2E_HOME"] !== "1") {
        await rm(home, { recursive: true, force: true });
      }
    },
  };
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
  await page.getByRole("button", { name: `${agentId} · ${sessionId.slice(0, 6)}` }).click();
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
