/**
 * Shared Playwright + Electron launch helpers. Every spec imports
 * `launchApp` to get a fresh Electron process. The helper:
 *   - points electron at the built main bundle (./out/main/index.js)
 *   - sets BACKCHAT_TEST_HOOKS=1 so main/preload register test IPC
 *   - returns the ElectronApplication + first BrowserWindow Page
 *
 * The build step (`pnpm build`) must have run before `pnpm test:e2e`.
 * package.json wires this as a prereq; in CI we always re-build first.
 */
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

export async function launchApp(): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const app = await electron.launch({
    args: [join(repoRoot, "out/main/index.js")],
    env: {
      ...process.env,
      BACKCHAT_TEST_HOOKS: "1",
      // Skip the renderer-side persistence load so each test starts
      // with an empty sidebar (the SQLite store still mounts at
      // ~/.openma/sessions.db; opt out of the seedPersisted call
      // would be cleaner, but for now we just tolerate any pre-existing
      // rows — tests assert on what they inject, not on totals).
      NODE_ENV: "test",
    },
  });
  const page = await app.firstWindow();
  // Wait for the React tree to mount — composer is the universally
  // visible piece of the empty-state shell.
  await page.waitForSelector('textarea[placeholder="Ask anything…"]', {
    timeout: 10_000,
  });
  return { app, page };
}

/** Push a `session.ready` event via the test IPC bridge so a fresh
 *  SessionRow shows up in the sidebar + becomes active in the chat
 *  pane. Returns the session id we synthesized. */
export async function injectSession(
  page: Page,
  opts: { agentId?: string; cwd?: string } = {},
): Promise<string> {
  const sessionId = `sess-test-${Math.random().toString(36).slice(2, 8)}`;
  await page.evaluate(
    async ({ sessionId, agentId, cwd }) => {
      // @ts-expect-error — test bridge typed in preload/index.ts
      await window.__backchatTest.injectSessionRow({
        session_id: sessionId,
        agent_id: agentId,
        cwd,
      });
    },
    { sessionId, agentId: opts.agentId ?? "claude-acp", cwd: opts.cwd ?? "/tmp/backchat-test" },
  );
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
