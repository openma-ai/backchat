import { expect, test } from "./fixtures";
import { enableAgent, launchApp } from "./helpers";
import { TestBridge } from "./test-bridge";

async function iconCenter(locator: import("@playwright/test").Locator) {
  return locator.evaluate((element) => {
    const target =
      element instanceof SVGElement
        ? element
        : element.querySelector("svg") ?? element;
    const box = target.getBoundingClientRect();
    return {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    };
  });
}

async function rowVerticalCenterDelta(
  rowSelector: string,
  target: import("@playwright/test").Locator,
) {
  return target.evaluate((element, selector) => {
    const row = element.closest(selector) as HTMLElement | null;
    if (!row) return 999;
    const rowBox = row.getBoundingClientRect();
    const targetBox = (element.querySelector("svg") ?? element).getBoundingClientRect();
    const rowCenter = rowBox.top + rowBox.height / 2;
    const targetCenter = targetBox.top + targetBox.height / 2;
    return Math.abs(rowCenter - targetCenter);
  }, rowSelector);
}

test("section header and row trailing icons share one column", async () => {
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

    const projectsHeader = page
      .getByRole("button", { name: "项目", exact: true })
      .locator('xpath=ancestor::*[contains(@class,"sidebar-section-header")][1]');
    const chatsHeader = page
      .getByRole("button", { name: "对话", exact: true })
      .locator('xpath=ancestor::*[contains(@class,"sidebar-section-header")][1]');

    await projectsHeader.hover();
    await chatsHeader.hover();

    const projectsAction = projectsHeader.getByRole("button", { name: "创建项目" });
    const chatsAction = chatsHeader.getByRole("button", { name: "新建会话" });
    await expect(projectsAction).toBeVisible();
    await expect(chatsAction).toBeVisible();

    const sessionRow = page
      .locator('[data-sidebar-scroll-area="true"] .sidebar-grid-row')
      .filter({ hasText: "codex-acp" })
      .first();
    await sessionRow.hover();
    const chatRowAction = sessionRow.locator('[data-sidebar-grid="trailing"] .sidebar-row-action').first();
    await expect(chatRowAction).toBeVisible({ timeout: 10_000 });

    const plusCenter = await iconCenter(projectsAction);
    const pencilCenter = await iconCenter(chatsAction);
    const rowCenter = await iconCenter(chatRowAction);

    expect(Math.abs(plusCenter.x - pencilCenter.x)).toBeLessThanOrEqual(0.75);
    expect(Math.abs(plusCenter.x - rowCenter.x)).toBeLessThanOrEqual(0.75);

    expect(await rowVerticalCenterDelta(".sidebar-section-header", projectsAction)).toBeLessThanOrEqual(
      0.75,
    );
    expect(await rowVerticalCenterDelta(".sidebar-section-header", chatsAction)).toBeLessThanOrEqual(
      0.75,
    );
    expect(await rowVerticalCenterDelta(".sidebar-grid-row", chatRowAction)).toBeLessThanOrEqual(
      0.75,
    );

    const coordinatorRow = page.locator('[data-testid="project-coordinator-row"]').first();
    if (await coordinatorRow.count()) {
      await coordinatorRow.hover();
      const coordinatorIcon = coordinatorRow.locator('[data-sidebar-grid="trailing"] svg');
      if (await coordinatorIcon.count()) {
        const coordinatorCenter = await iconCenter(coordinatorIcon);
        expect(Math.abs(plusCenter.x - coordinatorCenter.x)).toBeLessThanOrEqual(0.75);
        expect(
          await rowVerticalCenterDelta(".sidebar-coordinator-row", coordinatorIcon),
        ).toBeLessThanOrEqual(0.75);
      }
    }
  } finally {
    await cleanup();
  }
});
