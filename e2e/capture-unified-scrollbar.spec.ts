import { mkdir } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { enableAgent, injectEvent, injectSession, launchApp } from "./helpers";
import { TestBridge } from "./test-bridge";

const artifactDir = "/opt/cursor/artifacts/screenshots";

test("capture unified scrollbar on sidebar and transcript", async () => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });

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
        session_id: `scroll-cap-${index}`,
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
        turn_id: `scroll-cap-turn-${index}`,
        event: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `段落 ${index}。\n\n` + "滚动条统一验收内容。\n\n".repeat(10),
          },
        },
      });
    }

    const expandSidebar = page.getByRole("button", { name: /展开侧栏|Expand sidebar/i });
    if (await expandSidebar.isVisible()) {
      await expandSidebar.click();
    }
    const sidebarViewport = sidebarScroll.locator('[data-slot="scroll-area-viewport"]');
    await sidebarViewport.evaluate((el) => {
      el.scrollTop = Math.min(el.scrollTop + 1, el.scrollHeight);
    });
    const chatScroller = page.locator(".chat-scrollbar").first();
    await expect(chatScroller).toBeVisible();
    await chatScroller.evaluate((el) => {
      el.scrollTop = Math.floor(el.scrollHeight / 3);
    });
    await expect(sidebarViewport).toHaveAttribute("data-chat-scrolling", "true");
    await expect(chatScroller).toHaveAttribute("data-chat-scrolling", "true");
    await page.waitForTimeout(200);

    const sidebarThumbWidth = await sidebarViewport.evaluate((el) => {
      const thumb = getComputedStyle(el, "::-webkit-scrollbar-thumb");
      const track = getComputedStyle(el, "::-webkit-scrollbar");
      return {
        track: track.width,
        border: thumb.borderTopWidth,
      };
    });
    const transcriptThumbWidth = await chatScroller.evaluate((el) => {
      const thumb = getComputedStyle(el, "::-webkit-scrollbar-thumb");
      const track = getComputedStyle(el, "::-webkit-scrollbar");
      return {
        track: track.width,
        border: thumb.borderTopWidth,
      };
    });
    expect(sidebarThumbWidth.track).toBe(transcriptThumbWidth.track);
    expect(sidebarThumbWidth.border).toBe(transcriptThumbWidth.border);

    await page.screenshot({
      path: `${artifactDir}/unified-scrollbar-after-thickness-zh.png`,
      fullPage: false,
    });
    await page.screenshot({
      path: `${artifactDir}/unified-scrollbar-sidebar-and-transcript-zh.png`,
      fullPage: false,
    });
  } finally {
    await cleanup();
  }
});
