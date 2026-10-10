/**
 * PR #56 acceptance captures — writes to PR56_ACCEPTANCE_ROOT/{before|after}/.
 * Run twice: once with BACKCHAT_E2E_APP_ROOT pointing at main build (before),
 * once at PR head (after). Same viewport and seeds for comparable shots.
 */
import { expect, test } from "./fixtures";
import {
  enableAgent,
  injectEvent,
  injectSession,
  launchApp,
} from "./helpers";
import {
  ensurePr56AcceptanceDir,
  pr56AcceptancePhase,
  pr56ShotPath,
} from "./pr56-acceptance-path";
import { TestBridge } from "./test-bridge";

const VIEWPORT = { width: 1400, height: 900 };

const codexFixture = {
  id: "codex-acp",
  label: "Codex",
  command: "codex-acp",
  detected: true,
  available: true,
  installed: true,
};

async function waitForHarnessProbeUi(page: import("@playwright/test").Page): Promise<void> {
  const probe = page.locator(
    'textarea[data-composer-harness-probe="true"], [data-composer-harness-probe="true"]',
  );
  if (pr56AcceptancePhase() === "after") {
    await probe.first().waitFor({ state: "visible", timeout: 35_000 });
    await page.waitForTimeout(300);
    return;
  }
  try {
    await probe.first().waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    await page.waitForTimeout(600);
  }
}

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

async function seedScrollableSidebar(page: import("@playwright/test").Page): Promise<void> {
  await enableAgent(page, "codex-acp");
  const bridge = new TestBridge(page);
  for (let index = 0; index < 28; index += 1) {
    await bridge.injectSessionRow({
      session_id: `accept-scroll-${index}`,
      agent_id: "codex-acp",
      cwd: "",
    });
  }
}

async function seedTranscript(page: import("@playwright/test").Page): Promise<string> {
  const sessionId = await injectSession(page, { agentId: "codex-acp", cwd: "" });
  for (let index = 0; index < 10; index += 1) {
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: `accept-turn-${index}`,
      event: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `Block ${index}\n\n` + "Scrollbar acceptance copy.\n\n".repeat(12),
        },
      },
    });
  }
  return sessionId;
}

const gridOverlayCss = `
  .sidebar-navigation .sidebar-grid-row {
    outline: 1px dashed oklch(0.55 0.12 30 / 0.85);
    outline-offset: -1px;
  }
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
`;

test.describe.serial("PR #56 acceptance bundle", () => {
  test.setTimeout(600_000);

  test.beforeAll(async () => {
    await ensurePr56AcceptanceDir();
  });

  test("01 harness probe placeholder (en)", async () => {
    const { page, cleanup } = await launchApp({
      language: "en",
      env: {
        BACKCHAT_E2E_VISIBLE: "1",
        BACKCHAT_E2E_SKIP_LIVE_HARNESS_PROBE: "0",
        BACKCHAT_TEST_SLOW_LIVE_PROBE_MS: "15000",
      },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await seedCodexHarness(page);
      await waitForHarnessProbeUi(page);
      await page.locator(".composer-stack-card").first().screenshot({
        path: pr56ShotPath("01-harness-probe-en.png"),
      });
    } finally {
      await cleanup();
    }
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
      await page.setViewportSize(VIEWPORT);
      await seedCodexHarness(page);
      await waitForHarnessProbeUi(page);
      await page.locator(".composer-stack-card").first().screenshot({
        path: pr56ShotPath("01-harness-probe-zh.png"),
      });
    } finally {
      await cleanup();
    }
  });

  test("03 sidebar grid overlay (zh)", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await seedScrollableSidebar(page);
      await page.addStyleTag({ content: gridOverlayCss });
      const sidebarViewport = page.locator(
        '[data-sidebar-scroll-area="true"] [data-slot="scroll-area-viewport"]',
      );
      await sidebarViewport.evaluate((el) => {
        el.scrollTop = Math.floor(el.scrollHeight / 4);
      });
      await page.screenshot({
        path: pr56ShotPath("03-sidebar-grid-overlay-zh.png"),
        clip: { x: 0, y: 0, width: 320, height: VIEWPORT.height },
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
      await page.setViewportSize(VIEWPORT);
      await seedScrollableSidebar(page);
      await page.addStyleTag({ content: gridOverlayCss });
      const sidebarViewport = page.locator(
        '[data-sidebar-scroll-area="true"] [data-slot="scroll-area-viewport"]',
      );
      await sidebarViewport.evaluate((el) => {
        el.scrollTop = Math.floor(el.scrollHeight / 4);
      });
      await page.screenshot({
        path: pr56ShotPath("03-sidebar-grid-overlay-en.png"),
        clip: { x: 0, y: 0, width: 320, height: VIEWPORT.height },
      });
    } finally {
      await cleanup();
    }
  });

  test("04 scrollbars — scrolling reveal", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await seedScrollableSidebar(page);
      await seedTranscript(page);
      const sidebarViewport = page.locator(
        '[data-sidebar-scroll-area="true"] [data-slot="scroll-area-viewport"]',
      );
      const chatScroller = page.locator(".chat-scrollbar").first();
      await sidebarViewport.evaluate((el) => {
        el.scrollTop = Math.floor(el.scrollHeight / 2);
      });
      await chatScroller.evaluate((el) => {
        el.scrollTop = Math.floor(el.scrollHeight / 2);
      });
      await expect(sidebarViewport).toHaveAttribute("data-chat-scrolling", "true");
      await expect(chatScroller).toHaveAttribute("data-chat-scrolling", "true");
      await page.waitForTimeout(250);
      await page.screenshot({
        path: pr56ShotPath("04-scrollbar-scrolling-active.png"),
        fullPage: false,
      });
    } finally {
      await cleanup();
    }
  });

  test("04 scrollbars — sidebar hover overlay", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await seedScrollableSidebar(page);
      await seedTranscript(page);
      const sidebarArea = page.locator(".sidebar-scroll-area");
      const sidebarViewport = sidebarArea.locator('[data-slot="scroll-area-viewport"]');
      await sidebarViewport.evaluate((el) => {
        el.scrollTop = Math.floor(el.scrollHeight / 2);
      });
      const box = await sidebarArea.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2);
      }
      await page.waitForTimeout(200);
      await page.screenshot({
        path: pr56ShotPath("04-scrollbar-sidebar-hover.png"),
        fullPage: false,
      });
    } finally {
      await cleanup();
    }
  });

  test("04 scrollbars — transcript hover", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await seedScrollableSidebar(page);
      await seedTranscript(page);
      const chatScroller = page.locator(".chat-scrollbar").first();
      await chatScroller.evaluate((el) => {
        el.scrollTop = Math.floor(el.scrollHeight / 2);
        el.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await expect(chatScroller).toHaveAttribute("data-chat-scrolling", "true");
      const box = await chatScroller.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
      }
      await page.waitForTimeout(200);
      await page.screenshot({
        path: pr56ShotPath("04-scrollbar-transcript-hover.png"),
        fullPage: false,
      });
    } finally {
      await cleanup();
    }
  });

  test("08 host picker compact menu", async () => {
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await enableAgent(page, "codex-acp");
      await page.locator('[data-composer-footer-control="runtime"]').click();
      await page.getByTestId("composer-host-picker-panel").waitFor();
      await page.waitForTimeout(200);
      await page.locator('[data-composer-footer-control="runtime"]').screenshot({
        path: pr56ShotPath("08-host-picker-menu.png"),
      });
      await page
        .getByTestId("composer-host-picker-panel")
        .locator("..")
        .screenshot({ path: pr56ShotPath("08-host-picker-panel.png") });
    } finally {
      await cleanup();
    }
  });
});
