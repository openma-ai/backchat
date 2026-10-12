/**
 * One-off UI evidence capture for the current branch.
 */
import { _electron as electron } from "@playwright/test";
import { mkdir, rm, mkdtemp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = "/opt/cursor/artifacts/screenshots";
const mainJs = join(repoRoot, "out/main/index.js");
const fakeAcpAgentPath = join(repoRoot, "e2e/fixtures/fake-acp-agent.mjs");

async function shot(page, name) {
  const path = join(outDir, name);
  await page.screenshot({ path });
  return path;
}

async function waitReady(page) {
  await page.waitForFunction(
    () => typeof window.backchat?.settingsGet === "function",
    undefined,
    { timeout: 60_000 },
  );
  await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });
  await page.evaluate(async () => {
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      appearance: { ...current.appearance, language: "en" },
    });
  });
}

async function launch({ skipWarmup = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), "backchat-ui-cap-"));
  const env = {
    ...process.env,
    BACKCHAT_HOME: home,
    BACKCHAT_TEST_HOOKS: "1",
    BACKCHAT_E2E_VISIBLE: "1",
    NODE_ENV: "test",
  };
  if (skipWarmup) env.BACKCHAT_E2E_SKIP_AGENT_WARMUP = "1";
  const app = await electron.launch({
    args: [mainJs, `--user-data-dir=${join(home, "electron-user-data")}`],
    env,
  });
  const page = await app.firstWindow();
  await waitReady(page);
  await page.waitForTimeout(500);
  return { app, page, home };
}

async function enableAgents(page, ids) {
  await page.evaluate(async (agentIds) => {
    const current = await window.backchat.settingsGet();
    const agents = [...(current.agents ?? [])];
    for (const id of agentIds) {
      const idx = agents.findIndex((a) => a.id === id);
      const row = idx >= 0 ? agents[idx] : { id, enabled: true, env: [] };
      if (idx >= 0) agents[idx] = { ...row, enabled: true };
      else agents.push({ id, enabled: true, env: [] });
    }
    await window.backchat.settingsPatch({ agents });
  }, ids);
}

async function seedAgentsFixture(page) {
  await page.evaluate(async () => {
    await window.__backchatTest.setAgentSetupFixture({
      agents: [
        {
          id: "pi-acp",
          label: "Pi",
          command: "pi",
          detected: true,
          available: true,
          installed: true,
          config_options: [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "gpt-4.1",
              options: [
                { value: "gpt-4.1", name: "GPT-4.1" },
                { value: "claude-sonnet", name: "Claude Sonnet" },
              ],
            },
          ],
          available_commands: [],
        },
        {
          id: "codex-acp",
          label: "Codex",
          command: "codex",
          detected: true,
          available: true,
          installed: true,
          config_options: [
            {
              id: "mode",
              name: "Permission",
              category: "mode",
              type: "select",
              currentValue: "agent",
              options: [
                { value: "read-only", name: "Read only" },
                { value: "agent", name: "Agent" },
                { value: "agent-full-access", name: "Full access" },
              ],
            },
          ],
          available_commands: [],
        },
      ],
      calls: [],
    });
  });
}

async function expandSidebar(page) {
  const expand = page.getByRole("button", { name: "Expand sidebar" });
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
    await page.waitForTimeout(350);
  }
}

async function openHomeComposer(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  const newChat = page.getByRole("button", { name: /New chat/i });
  if (await newChat.isVisible().catch(() => false)) {
    await newChat.click().catch(() => {});
  }
}

async function runStep(label, fn) {
  try {
    const path = await fn();
    console.log(`${label}: ${path}`);
    return path;
  } catch (error) {
    console.error(`${label} FAILED:`, error);
    return null;
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const results = [];

  // 1) Sidebar expanded
  await runStep("1-sidebar", async () => {
    const { app, page, home } = await launch();
    try {
      await enableAgents(page, ["codex-acp", "pi-acp"]);
      await seedAgentsFixture(page);
      await page.reload();
      await waitReady(page);
      await expandSidebar(page);
      return await shot(page, "backchat-sidebar-expanded.png");
    } finally {
      await app.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  // 2) Dual scrollbars (sidebar list + right rail)
  await runStep("2-scrollbars", async () => {
    const { app, page, home } = await launch();
    try {
      await enableAgents(page, ["codex-acp"]);
      await page.evaluate(async () => {
        for (let i = 0; i < 28; i++) {
          await window.__backchatTest.injectSessionRow({
            session_id: `ui-scroll-${i}`,
            agent_id: "codex-acp",
            cwd: `/tmp/scroll-demo-${i}`,
          });
        }
      });
      await page.waitForTimeout(600);
      await expandSidebar(page);
      await page.locator('[data-sidebar-scroll-area="true"]').evaluate((el) => {
        el.scrollTop = 520;
      });
      await page.getByRole("link", { name: "Settings" }).click();
      await page.waitForTimeout(800);
      await page.locator("main").evaluate((el) => {
        el.scrollTop = 280;
      });
      return await shot(page, "backchat-dual-scrollbars.png");
    } finally {
      await app.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  // 3) Model selector + pi submenu
  await runStep("3-model-pi", async () => {
    const { app, page, home } = await launch();
    try {
      await enableAgents(page, ["pi-acp", "codex-acp"]);
      await seedAgentsFixture(page);
      await page.reload();
      await waitReady(page);
      await page.evaluate(async () => {
        const current = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          default: { ...current.default, agent_id: "pi-acp" },
        });
      });
      await page.reload();
      await waitReady(page);
      await page.locator('[data-composer-run-trigger="true"]').click();
      await page.getByRole("menuitem", { name: /Harness/i }).hover();
      await page.waitForTimeout(250);
      await page.getByRole("menuitem", { name: "Pi", exact: true }).hover();
      await page.waitForTimeout(250);
      await page.getByRole("menuitem", { name: "Model" }).hover();
      await page.waitForTimeout(350);
      return await shot(page, "backchat-model-selector-pi-submenu.png");
    } finally {
      await app.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  // 4) Project selector
  await runStep("4-project", async () => {
    const { app, page, home } = await launch();
    try {
      await enableAgents(page, ["codex-acp"]);
      await page.locator('[data-composer-footer-control="project"]').click();
      await page.waitForTimeout(400);
      return await shot(page, "backchat-project-selector.png");
    } finally {
      await app.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  // 5) Codex permission mode
  await runStep("5-codex-perm", async () => {
    const { app, page, home } = await launch();
    try {
      await enableAgents(page, ["codex-acp"]);
      await seedAgentsFixture(page);
      await page.reload();
      await waitReady(page);
      await page.evaluate(async () => {
        const current = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          default: { ...current.default, agent_id: "codex-acp" },
        });
      });
      await page.reload();
      await waitReady(page);
      await page.getByRole("button", { name: "Approve for me" }).click({ timeout: 10_000 });
      await page.waitForTimeout(350);
      return await shot(page, "backchat-codex-permission-mode.png");
    } finally {
      await app.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  // 6) Error recovery surface (in-chat fallback after session.error)
  await runStep("6-crash-fallback", async () => {
    const { app, page, home } = await launch();
    try {
      await enableAgents(page, ["codex-acp"]);
      await page.evaluate(async () => {
        await window.__backchatTest.injectSessionRow({
          session_id: "ui-crash-demo",
          agent_id: "codex-acp",
          cwd: "/tmp/ui-crash-demo",
        });
      });
      const sessionId = "ui-crash-demo";
      const agentId = "codex-acp";
      await page.getByRole("navigation").getByRole("button", { name: "ui-crash-demo" }).waitFor({
        state: "visible",
        timeout: 15_000,
      });
      await page.getByRole("button", { name: `${agentId} · ${sessionId.slice(0, 6)}` }).click({
        timeout: 5000,
      }).catch(async () => {
        await page.getByRole("button", { name: "ui-crash-demo", exact: true }).click();
      });
      await page.waitForTimeout(600);
      const turnId = "turn-crash-demo";
      await page.evaluate(async ({ sessionId, turnId }) => {
        await window.__backchatTest.injectSessionEvent({
          type: "session.event",
          session_id: sessionId,
          turn_id: turnId,
          event: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Working…" },
          },
        });
        await window.__backchatTest.injectSessionEvent({
          type: "session.queue_update",
          session_id: sessionId,
          mode: "single",
          active_turn_id: turnId,
          queued: [],
        });
        await window.__backchatTest.injectSessionEvent({
          type: "session.error",
          session_id: sessionId,
          message: "The agent connection was lost. You can edit your message and try again.",
        });
      }, { sessionId, turnId });
      await page.getByText("The agent connection was lost", { exact: false }).waitFor({
        state: "visible",
        timeout: 20_000,
      });
      return await shot(page, "backchat-crash-fallback.png");
    } finally {
      await app.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  // 7) Composer harness auth loading spinner
  await runStep("7-composer-loading", async () => {
    const { app, page, home } = await launch({ skipWarmup: false });
    try {
      await page.evaluate(async ({ nodePath, fakeAgentPath }) => {
        const current = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          agents: [
            {
              id: "codex-acp",
              enabled: true,
              command_override: nodePath,
              args_override: [fakeAgentPath],
              env: [],
            },
          ],
        });
      }, { nodePath: process.execPath, fakeAgentPath: fakeAcpAgentPath });
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitReady(page);
      const spinner = page.locator('[data-composer-run-harness="true"] svg.animate-spin');
      await spinner.waitFor({ state: "visible", timeout: 20_000 });
      return await shot(page, "backchat-composer-auth-loading.png");
    } finally {
      await app.close();
      await rm(home, { recursive: true, force: true });
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
