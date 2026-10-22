import { expect, test } from "./fixtures";
import { enableAgent, launchApp } from "./helpers";
import { TestBridge } from "./test-bridge";

async function gridColumnLeft(
  row: import("@playwright/test").Locator,
  slot: "icon" | "label" | "trailing",
) {
  return row.locator(`[data-sidebar-grid="${slot}"]`).evaluate((cell) => {
    const box = cell.getBoundingClientRect();
    return box.left;
  });
}

async function actionCenterX(action: import("@playwright/test").Locator) {
  return action.evaluate((element) => {
    const target = element.querySelector("svg") ?? element;
    const box = target.getBoundingClientRect();
    return box.left + box.width / 2;
  });
}

test("sidebar rows share icon and trailing column x-positions", async () => {
  const { page, cleanup } = await launchApp({
    language: "zh-CN",
    env: { BACKCHAT_E2E_VISIBLE: "1" },
  });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await enableAgent(page, "codex-acp");
    const bridge = new TestBridge(page);
    for (let index = 0; index < 24; index += 1) {
      await bridge.injectSessionRow({
        session_id: `grid-track-${index}`,
        agent_id: "codex-acp",
        cwd: "",
      });
    }

    const hostRow = page.locator(".sidebar-host-chrome .sidebar-grid-row").first();
    const scheduledRow = page.locator('.sidebar-scroll-content a.sidebar-grid-row[href*="scheduled"]');
    const projectsHeader = page.locator(".sidebar-section-header.sidebar-grid-row").filter({
      has: page.getByRole("button", { name: "项目", exact: true }),
    });
    const chatsHeader = page.locator(".sidebar-section-header.sidebar-grid-row").filter({
      has: page.getByRole("button", { name: "对话", exact: true }),
    });
    const footerRow = page.locator(".sidebar-footer-chrome .sidebar-grid-row").first();

    const sidebarViewport = page.locator(
      '[data-sidebar-scroll-area="true"] [data-slot="scroll-area-viewport"]',
    );
    await sidebarViewport.evaluate((el) => {
      el.scrollTop = Math.floor(el.scrollHeight / 3);
    });
    await expect(sidebarViewport).toHaveAttribute("data-chat-scrolling", "true");

    await projectsHeader.hover();
    await chatsHeader.hover();

    const sessionRow = page
      .locator(".sidebar-scroll-content .sidebar-grid-row")
      .filter({ hasText: "codex-acp" })
      .first();
    await sessionRow.hover();
    await expect(sessionRow.locator('[data-sidebar-grid-action="last"]')).toBeVisible({
      timeout: 10_000,
    });

    const localRuntimeRow = page.getByTestId("sidebar-local-runtime-row");
    const depth0IconLefts = await Promise.all([
      gridColumnLeft(hostRow, "icon"),
      gridColumnLeft(scheduledRow, "icon"),
      gridColumnLeft(localRuntimeRow, "icon"),
      gridColumnLeft(projectsHeader, "icon"),
      gridColumnLeft(chatsHeader, "icon"),
      gridColumnLeft(footerRow, "icon"),
    ]);
    const depth0Reference = depth0IconLefts[0];
    for (const left of depth0IconLefts) {
      expect(Math.abs(left - depth0Reference)).toBeLessThanOrEqual(0.75);
    }

    const sessionIcon = await gridColumnLeft(sessionRow, "icon");
    expect(Math.abs(sessionIcon - depth0Reference - 16)).toBeLessThanOrEqual(0.75);

    const hostSearch = hostRow.locator('[data-sidebar-grid-action="penultimate"]');
    const hostMenu = hostRow.locator('[data-sidebar-grid-action="last"]');
    const chatsPencil = chatsHeader.locator('[data-sidebar-grid-action="penultimate"]');
    const projectsPlus = projectsHeader.locator('[data-sidebar-grid-action="last"]');
    const sessionMenu = sessionRow.locator('[data-sidebar-grid-action="last"]');

    await expect(hostSearch).toBeVisible();
    await expect(hostMenu).toBeVisible();
    await expect(chatsPencil).toBeVisible();
    await expect(projectsPlus).toBeVisible();

    const searchCenter = await actionCenterX(hostSearch);
    const pencilCenter = await actionCenterX(chatsPencil);
    const hostMenuCenter = await actionCenterX(hostMenu);
    const sessionMenuCenter = await actionCenterX(sessionMenu);
    const projectsPlusCenter = await actionCenterX(projectsPlus);

    expect(Math.abs(searchCenter - pencilCenter)).toBeLessThanOrEqual(0.75);
    expect(Math.abs(hostMenuCenter - sessionMenuCenter)).toBeLessThanOrEqual(0.75);
    expect(Math.abs(hostMenuCenter - projectsPlusCenter)).toBeLessThanOrEqual(0.75);

    const projectRow = page.locator(".sidebar-project-row").first();
    if (await projectRow.count()) {
      await projectRow.hover();
      const projectPencil = projectRow.locator('[data-sidebar-grid-action="penultimate"]');
      const projectMenu = projectRow.locator('[data-sidebar-grid-action="last"]');
      if (await projectPencil.count()) {
        expect(Math.abs(searchCenter - await actionCenterX(projectPencil))).toBeLessThanOrEqual(0.75);
        expect(Math.abs(hostMenuCenter - await actionCenterX(projectMenu))).toBeLessThanOrEqual(0.75);
      }
    }

    const coordinatorRow = page.locator('[data-testid="project-coordinator-row"]').first();
    if (await coordinatorRow.count()) {
      const coordinatorIcon = await gridColumnLeft(coordinatorRow, "icon");
      expect(Math.abs(coordinatorIcon - sessionIcon)).toBeLessThanOrEqual(0.75);
    }
  } finally {
    await cleanup();
  }
});
