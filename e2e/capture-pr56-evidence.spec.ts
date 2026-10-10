/**
 * PR #56 UI evidence — outputs pr56-01.png … pr56-11.png under artifactDir.
 */
import { execFile as execFileCallback } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./fixtures";
import {
  enableAgent,
  injectEvent,
  injectSession,
  launchApp,
  persistSessionFixture,
} from "./helpers";
import { TestBridge } from "./test-bridge";
import { ensurePr56AcceptanceDir } from "./pr56-acceptance-path";
import { pr56Shot } from "./pr56-shot";

const execFile = promisify(execFileCallback);

const codexFixture = {
  id: "codex-acp",
  label: "Codex",
  command: "codex-acp",
  detected: true,
  available: true,
  installed: true,
  config_options: [
    {
      id: "mode",
      name: "Session mode",
      category: "mode",
      type: "select",
      currentValue: "agent",
      options: [
        { value: "read-only", name: "Ask for approval" },
        { value: "agent", name: "Approve for me" },
        { value: "agent-full-access", name: "Full access" },
      ],
    },
  ],
};

const piFixture = {
  id: "pi-acp",
  label: "Pi",
  command: "pi-acp",
  detected: true,
  available: true,
  installed: true,
};

async function seedCodexHarness(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async (fixture) => {
    await window.__backchatTest.setAgentSetupFixture({ agents: [fixture] });
    const settings = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      agents: [
        ...settings.agents.filter((agent) => agent.id !== fixture.id),
        { id: fixture.id, enabled: true, env: [] },
      ],
      default: { ...settings.default, agent_id: fixture.id },
    });
  }, codexFixture);
  await page.reload();
  await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });
}

function groupedModelOptions(count: number) {
  const providers = ["anthropic-proxy", "openai-codex", "devin", "minimax-m31"];
  return providers.map((provider) => ({
    group: provider,
    name: provider,
    options: Array.from({ length: Math.ceil(count / providers.length) }, (_, index) => ({
      value: `${provider}-${index}`,
      name: `${provider} model ${index}`,
    })),
  }));
}

test.describe.serial("PR #56 evidence captures", () => {
  test.setTimeout(600_000);

  test.beforeAll(async () => {
    await ensurePr56AcceptanceDir();
    await mkdir("/opt/cursor/artifacts/screenshots", { recursive: true });
  });

  test("01 startup harness probe loading in composer", async () => {
    const { page, cleanup } = await launchApp({
      language: "en",
      env: {
        BACKCHAT_E2E_VISIBLE: "1",
        BACKCHAT_E2E_SKIP_LIVE_HARNESS_PROBE: "0",
        BACKCHAT_TEST_SLOW_LIVE_PROBE_MS: "15000",
      },
    });
    try {
      await seedCodexHarness(page);
      await page.waitForSelector('[data-composer-harness-probe="true"]', {
        timeout: 35_000,
      });
      await page.waitForTimeout(400);
      await page.locator(".composer-stack-card").first().screenshot({
        path: pr56Shot("01-harness-probe-en.png"),
      });
    } finally {
      await cleanup();
    }
  });

  test("02 sidebar expand — icons and labels visible together", async () => {
    const { page, cleanup } = await launchApp({
      language: "en",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await enableAgent(page, "codex-acp");
      const bridge = new TestBridge(page);
      await bridge.injectSessionRow({
        session_id: "pr56-expand-demo",
        agent_id: "codex-acp",
        cwd: "",
      });
      await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });
      const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
      if (await collapse.isVisible()) {
        await collapse.click();
      }
      const expand = page.getByRole("button", { name: "Expand sidebar", exact: true });
      await expand.waitFor({ state: "visible", timeout: 10_000 });
      await expand.click();
      await page.waitForTimeout(160);
      await page.locator("aside.theme-sidebar-background").screenshot({
        path: pr56Shot("02-sidebar-expand.png"),
      });
    } finally {
      await cleanup();
    }
  });

  test("03 sidebar unified grid alignment", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await enableAgent(page, "codex-acp");
      const bridge = new TestBridge(page);
      for (let index = 0; index < 20; index += 1) {
        await bridge.injectSessionRow({
          session_id: `pr56-grid-${index}`,
          agent_id: "codex-acp",
          cwd: "",
        });
      }
      const sidebarViewport = page.locator(
        '[data-sidebar-scroll-area="true"] [data-slot="scroll-area-viewport"]',
      );
      await sidebarViewport.evaluate((el) => {
        el.scrollTop = Math.floor(el.scrollHeight / 4);
      });
      await page.locator(".sidebar-host-chrome").hover();
      await page.locator(".sidebar-section-header").filter({
        has: page.getByRole("button", { name: "对话", exact: true }),
      }).hover();
      await page.addStyleTag({
        content: `
        .sidebar-navigation [data-sidebar-grid="icon"]::after {
          content: "";
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          width: 1px;
          transform: translateX(-50%);
          background: oklch(0.45 0.1 30 / 0.75);
          pointer-events: none;
        }
        .sidebar-navigation [data-sidebar-grid="icon"] {
          position: relative;
          background: oklch(0.62 0.08 30 / 0.12);
        }
      `,
      });
      await page.locator('[data-testid="sidebar-local-runtime-row"]').hover();
      await page.screenshot({
        path: pr56Shot("03-sidebar-grid-overlay-zh.png"),
        clip: { x: 0, y: 0, width: 320, height: 900 },
      });
    } finally {
      await cleanup();
    }
  });

  test("04 unified scrollbars sidebar and transcript", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize({ width: 1400, height: 900 });
      await enableAgent(page, "codex-acp");
      const bridge = new TestBridge(page);
      for (let index = 0; index < 28; index += 1) {
        await bridge.injectSessionRow({
          session_id: `pr56-scroll-${index}`,
          agent_id: "codex-acp",
          cwd: "",
        });
      }
      const sidebarScroll = page.locator('[data-sidebar-scroll-area="true"]');
      await sidebarScroll.locator('[data-slot="scroll-area-viewport"]').evaluate((el) => {
        el.scrollTop = Math.floor(el.scrollHeight / 2);
      });
      const sessionId = await injectSession(page, { agentId: "codex-acp", cwd: "" });
      for (let index = 0; index < 8; index += 1) {
        await injectEvent(page, {
          type: "session.event",
          session_id: sessionId,
          turn_id: `pr56-scroll-turn-${index}`,
          event: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `段落 ${index}。\n\n` + "滚动条统一验收。\n\n".repeat(10),
            },
          },
        });
      }
      const expandSidebar = page.getByRole("button", { name: /展开侧栏|Expand sidebar/i });
      if (await expandSidebar.isVisible()) await expandSidebar.click();
      const chatScroller = page.locator(".chat-scrollbar").first();
      await chatScroller.evaluate((el) => {
        el.scrollTop = Math.floor(el.scrollHeight / 3);
      });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: pr56Shot("04-scrollbar-scrolling-active.png"),
        fullPage: false,
      });
    } finally {
      await cleanup();
    }
  });

  test("05 sidebar section rounded gaps", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await enableAgent(page, "codex-acp");
      await persistSessionFixture(page, {
        sessionId: "pr56-gap-demo",
        title: "间距验收对话",
        agentId: "codex-acp",
        cwd: "",
        acpSessionId: "acp-pr56-gap",
        events: [],
      });
      await page.reload();
      await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });
      const sidebar = page.getByRole("complementary");
      const chatsHeader = sidebar.locator(
        "section.sidebar-section > .sidebar-section-header",
      ).filter({
        has: page.getByRole("button", { name: "对话", exact: true }),
      });
      const chatsSection = chatsHeader.locator("xpath=ancestor::section[1]");
      await page.getByRole("button", { name: "间距验收对话", exact: true }).click();
      await chatsHeader.hover();
      await page.waitForTimeout(300);
      await chatsSection.screenshot({ path: pr56Shot("05-gap-token.png") });
    } finally {
      await cleanup();
    }
  });

  test("06 project picker grid and scrollbar overlay", async ({ page, home }) => {
    await page.evaluate(async (path) => {
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        appearance: { ...current.appearance, theme: "dark", language: "en" },
      });
      await window.backchat.projectSave({
        project_id: "pr56-picker-a",
        name: "Alpha workspace",
        source_folders: [path],
        primary_folder: path,
      });
      await window.backchat.projectSave({
        project_id: "pr56-picker-b",
        name: "Beta monorepo",
        source_folders: [path],
        primary_folder: path,
      });
    }, home);
    await page.reload();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    const trigger = page.locator('[data-composer-footer-control="project"]');
    await trigger.click();
    const panel = page.getByTestId("composer-project-picker-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const viewport = panel.locator('[data-slot="scroll-area-viewport"]');
    await viewport.evaluate((element) => {
      element.scrollTop = 80;
    });
    await page.screenshot({
      path: pr56Shot("06-project-picker.png"),
      animations: "disabled",
    });
  });

  test("07 model picker height search and pi submenu path", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await enableAgent(page, "codex-acp");
      const sessionId = await injectSession(page, { agentId: "codex-acp" });
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: "pr56-model",
        event: {
          sessionUpdate: "config_option_update",
          configOptions: [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "openai-codex-2",
              options: groupedModelOptions(24),
            },
          ],
        },
      });
      await page.locator('[data-composer-run-trigger="true"]').click();
      await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
      const panel = page.getByTestId("composer-select-menu-panel");
      await expect(panel).toBeVisible({ timeout: 10_000 });
      await panel.locator('input[type="search"], input[cmdk-input]').fill("minimax-m31 0");
      await page.waitForTimeout(200);
      await page.screenshot({
        path: pr56Shot("07-model-picker-search.png"),
        fullPage: false,
      });
    } finally {
      await cleanup();
    }
  });

  test("08 selected host row without gray highlight", async ({ page, home }) => {
    const repo = join(home, "pr56-host-repo");
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
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        appearance: { ...current.appearance, language: "zh-CN" },
      });
      await window.backchat.projectSave({
        project_id: "pr56-host",
        name: "Host demo",
        source_folders: [path],
        primary_folder: path,
      });
    }, repo);
    await page.reload();
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    await page.locator('[data-composer-footer-control="project"]').click();
    await page.getByRole("option", { name: "Host demo", exact: true }).click();
    const runtimeTrigger = page.locator('[data-composer-footer-control="runtime"]');
    await runtimeTrigger.click();
    await page.screenshot({
      path: pr56Shot("08-host-picker-highlight.png"),
      animations: "disabled",
    });
  });

  test("09 harness select shows agent icons", async () => {
    const { page, cleanup } = await launchApp({
      language: "en",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.evaluate(async (fixtures) => {
        await window.__backchatTest.setAgentSetupFixture({ agents: fixtures });
        const settings = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          agents: fixtures.map((f) => ({
            id: f.id,
            enabled: true,
            env: [],
          })),
          default: { ...settings.default, agent_id: "codex-acp" },
        });
      }, [codexFixture, piFixture]);
      await page.reload();
      await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });
      await page.locator('[data-composer-run-trigger="true"]').click();
      await page.getByRole("menuitem", { name: /Harness/i }).hover();
      await page.waitForTimeout(350);
      await page.screenshot({
        path: pr56Shot("09-harness-icons.png"),
        fullPage: false,
      });
    } finally {
      await cleanup();
    }
  });

  test("10 codex permission modes capped to probe", async () => {
    const { page, cleanup } = await launchApp({
      language: "en",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await seedCodexHarness(page);
      const sessionId = await injectSession(page, { agentId: "codex-acp" });
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: "pr56-mode",
        event: {
          sessionUpdate: "config_option_update",
          configOptions: [
            {
              id: "mode",
              name: "Session mode",
              category: "mode",
              type: "select",
              currentValue: "agent",
              options: [
                { value: "read-only", name: "Ask for approval" },
                { value: "agent", name: "Approve for me" },
                { value: "agent-full-access", name: "Full access" },
                { value: "workspace-access", name: "Workspace access" },
              ],
            },
          ],
        },
      });
      await page.getByRole("button", { name: "Approve for me" }).click();
      await page.waitForTimeout(300);
      await page.locator(".composer-stack-card").first().screenshot({
        path: pr56Shot("10-codex-permissions.png"),
      });
    } finally {
      await cleanup();
    }
  });

  test("11 renderer crash page (en + zh)", async () => {
    const capture = async (filename: string, language?: "en" | "zh-CN") => {
      const { page, cleanup } = await launchApp({
        language,
        skipRendererReady: true,
        env: {
          BACKCHAT_DEMO_RENDERER_CRASH: "1",
          BACKCHAT_E2E_VISIBLE: "1",
        },
      });
      try {
        if (language === "zh-CN") {
          await page.evaluate(async () => {
            const current = await window.backchat.settingsGet();
            await window.backchat.settingsPatch({
              appearance: { ...current.appearance, language: "zh-CN" },
            });
          });
          await page.reload({ waitUntil: "domcontentloaded" });
        }
        await page.waitForSelector('[data-backchat-crash-mark="true"]', {
          timeout: 30_000,
        });
        await page.waitForTimeout(400);
        await page.screenshot({
          path: pr56Shot(filename),
          fullPage: true,
        });
      } finally {
        await cleanup();
      }
    };
    await capture("11-crash-en.png");
    await capture("11-crash-zh.png", "zh-CN");
  });

  test("01 harness probe placeholder (zh)", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: {
        BACKCHAT_E2E_VISIBLE: "1",
        BACKCHAT_E2E_SKIP_LIVE_HARNESS_PROBE: "0",
        BACKCHAT_TEST_SLOW_LIVE_PROBE_MS: "15000",
      },
    });
    try {
      await seedCodexHarness(page);
      await page.waitForSelector(
        'textarea[data-composer-harness-probe="true"], [data-composer-harness-probe="true"]',
        { timeout: 35_000 },
      );
      await page.waitForTimeout(400);
      await page.locator(".composer-stack-card").first().screenshot({
        path: pr56Shot("01-harness-probe-zh.png"),
      });
    } finally {
      await cleanup();
    }
  });

  test("03 sidebar grid overlay (en)", async () => {
    const { page, cleanup } = await launchApp({
      language: "en",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize({ width: 1400, height: 900 });
      await enableAgent(page, "codex-acp");
      const bridge = new TestBridge(page);
      for (let index = 0; index < 20; index += 1) {
        await bridge.injectSessionRow({
          session_id: `pr56-grid-en-${index}`,
          agent_id: "codex-acp",
          cwd: "",
        });
      }
      await page.addStyleTag({
        content: `
        .sidebar-navigation [data-sidebar-grid="icon"]::after {
          content: "";
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          width: 1px;
          transform: translateX(-50%);
          background: oklch(0.45 0.1 30 / 0.75);
        }
        .sidebar-navigation [data-sidebar-grid="icon"] { position: relative; }
      `,
      });
      await page.locator('[data-testid="sidebar-local-runtime-row"]').hover();
      await page.screenshot({
        path: pr56Shot("03-sidebar-grid-overlay-en.png"),
        clip: { x: 0, y: 0, width: 320, height: 900 },
      });
    } finally {
      await cleanup();
    }
  });

  test("04 scrollbars sidebar hover and transcript hover", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize({ width: 1400, height: 900 });
      await enableAgent(page, "codex-acp");
      const bridge = new TestBridge(page);
      for (let index = 0; index < 28; index += 1) {
        await bridge.injectSessionRow({
          session_id: `pr56-scroll-hover-${index}`,
          agent_id: "codex-acp",
          cwd: "",
        });
      }
      const sessionId = await injectSession(page, { agentId: "codex-acp", cwd: "" });
      for (let index = 0; index < 8; index += 1) {
        await injectEvent(page, {
          type: "session.event",
          session_id: sessionId,
          turn_id: `pr56-scroll-hover-${index}`,
          event: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `段落 ${index}\n\n` + "滚动条。\n\n".repeat(12),
            },
          },
        });
      }
      const sidebarArea = page.locator(".sidebar-scroll-area");
      const sidebarViewport = sidebarArea.locator('[data-slot="scroll-area-viewport"]');
      const chatScroller = page.locator(".chat-scrollbar").first();
      await sidebarViewport.evaluate((el) => {
        el.scrollTop = Math.floor(el.scrollHeight / 2);
      });
      await chatScroller.evaluate((el) => {
        el.scrollTop = Math.floor(el.scrollHeight / 2);
      });
      const sidebarBox = await sidebarArea.boundingBox();
      if (sidebarBox) {
        await page.mouse.move(sidebarBox.x + sidebarBox.width - 6, sidebarBox.y + sidebarBox.height / 2);
      }
      await page.waitForTimeout(200);
      await page.screenshot({
        path: pr56Shot("04-scrollbar-sidebar-hover.png"),
        fullPage: false,
      });
      const chatBox = await chatScroller.boundingBox();
      if (chatBox) {
        await page.mouse.move(chatBox.x + chatBox.width - 4, chatBox.y + chatBox.height / 2);
      }
      await page.waitForTimeout(200);
      await page.screenshot({
        path: pr56Shot("04-scrollbar-transcript-hover.png"),
        fullPage: false,
      });
    } finally {
      await cleanup();
    }
  });

  test("07 model picker pi submenu bottom align", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.evaluate(async (fixture) => {
        await window.__backchatTest.setAgentSetupFixture({ agents: [fixture] });
        const settings = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          agents: [{ id: fixture.id, enabled: true, env: [] }],
          default: { ...settings.default, agent_id: fixture.id },
        });
      }, piFixture);
      await page.reload();
      const sessionId = await injectSession(page, { agentId: "pi-acp" });
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: "pr56-pi-model",
        event: {
          sessionUpdate: "config_option_update",
          configOptions: [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "pi-1",
              options: groupedModelOptions(8),
            },
          ],
        },
      });
      await page.locator('[data-composer-run-trigger="true"]').click();
      await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: pr56Shot("07-model-picker-submenu.png"),
        fullPage: false,
      });
    } finally {
      await cleanup();
    }
  });

  test("08 host picker adaptive height panel", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await enableAgent(page, "codex-acp");
      await page.locator('[data-composer-footer-control="runtime"]').click();
      const panel = page.getByTestId("composer-host-picker-panel");
      await panel.waitFor({ timeout: 10_000 });
      await page.waitForTimeout(200);
      await panel.locator("xpath=ancestor::*[@data-slot='dropdown-menu-content'][1]").screenshot({
        path: pr56Shot("08-host-picker-panel.png"),
      });
    } finally {
      await cleanup();
    }
  });

  test("regression grouped menu in coordinator settings", async ({ page, home }) => {
    await page.evaluate(
      async ({ node, agent, projectHome }) => {
        await window.backchat.settingsPatch({
          agents: [
            {
              id: "codex-acp",
              enabled: true,
              command_override: node,
              args_override: [agent],
              env: [],
            },
          ],
        });
        await window.backchat.projectSave({
          project_id: "pr56-reg-menu",
          name: "Reg menu",
          source_folders: [projectHome],
          primary_folder: projectHome,
        });
      },
      {
        node: process.execPath,
        agent: join(process.cwd(), "e2e/fixtures/fake-acp-agent.mjs"),
        projectHome: home,
      },
    );
    await page.reload();
    const row = page.locator('[data-sidebar-project="project:pr56-reg-menu"]');
    await row.hover();
    await row.getByRole("button", { name: /project actions/i }).click();
    await page.getByRole("menuitem", { name: /Project settings/i }).click();
    await page.getByRole("button", { name: "Configure", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Coordinator settings", exact: true });
    await dialog.getByRole("tab", { name: "Agents", exact: true }).click();
    const execution = dialog.getByRole("combobox", {
      name: "Execution location",
      exact: true,
    });
    await execution.click();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: pr56Shot("reg-settings-grouped-menu.png"),
      animations: "disabled",
    });
  });

  test("regression composer footer controls", async () => {
    const { page, cleanup } = await launchApp({
      language: "en",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await enableAgent(page, "codex-acp");
      await page.locator(".composer-stack-card").first().screenshot({
        path: pr56Shot("reg-composer-footer.png"),
      });
    } finally {
      await cleanup();
    }
  });

  test("regression sidebar local runtime row", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await enableAgent(page, "codex-acp");
      const row = page.getByTestId("sidebar-local-runtime-row");
      await row.click();
      await page.getByTestId("sidebar-host-picker-panel").waitFor();
      await page.waitForTimeout(200);
      await row.screenshot({ path: pr56Shot("reg-sidebar-local-host.png") });
    } finally {
      await cleanup();
    }
  });
});
