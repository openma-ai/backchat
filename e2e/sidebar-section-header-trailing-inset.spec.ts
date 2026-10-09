import { expect, test } from "./fixtures";
import { enableAgent, launchApp } from "./helpers";
import { TestBridge } from "./test-bridge";

test("section header trailing actions share the same right inset", async () => {
  const { page, cleanup } = await launchApp({
    language: "zh-CN",
    env: { BACKCHAT_E2E_VISIBLE: "1" },
  });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await enableAgent(page, "codex-acp");
    const bridge = new TestBridge(page);
    await bridge.injectSessionRow({
      session_id: "section-inset-chat",
      agent_id: "codex-acp",
      cwd: "",
    });

    const viewport = page.locator(
      '[data-sidebar-scroll-area="true"] [data-slot="scroll-area-viewport"]',
    );
    const projectsAction = page.getByRole("button", { name: "创建项目" });
    const chatsAction = page.getByRole("button", { name: "新建会话" });
    const projectsHeader = projectsAction.locator(
      'xpath=ancestor::*[contains(@class,"sidebar-section-header")][1]',
    );
    const chatsHeader = chatsAction.locator(
      'xpath=ancestor::*[contains(@class,"sidebar-section-header")][1]',
    );

    await projectsHeader.hover();
    await chatsHeader.hover();
    await expect(projectsAction).toBeVisible();
    await expect(chatsAction).toBeVisible();

    const trailingInset = async (action: import("@playwright/test").Locator) =>
      action.evaluate((element) => {
        const viewport = element
          .closest('[data-slot="scroll-area-viewport"]') as HTMLElement | null;
        if (!viewport) return -1;
        return viewport.getBoundingClientRect().right - element.getBoundingClientRect().right;
      });

    const chatRowAction = page
      .locator('[data-sidebar-scroll-area="true"] .sidebar-row-trailing .sidebar-row-action')
      .first();
    await expect(chatRowAction).toBeVisible({ timeout: 10_000 });

    const projectsInset = await trailingInset(projectsAction);
    const chatsInset = await trailingInset(chatsAction);
    const rowInset = await trailingInset(chatRowAction);

    expect(projectsInset).toBeGreaterThan(0);
    expect(Math.abs(projectsInset - chatsInset)).toBeLessThanOrEqual(1);
    expect(Math.abs(projectsInset - rowInset)).toBeLessThanOrEqual(1);

    const scrollbarAwareEnd = await page.locator(".sidebar-scroll-content").evaluate((element) =>
      getComputedStyle(element).paddingInlineEnd,
    );
    expect(scrollbarAwareEnd).toBe("8px");
  } finally {
    await cleanup();
  }
});
