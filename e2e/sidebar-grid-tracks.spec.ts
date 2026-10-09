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

async function gridColumnCenterX(
  row: import("@playwright/test").Locator,
  slot: "icon" | "trailing",
) {
  return row.locator(`[data-sidebar-grid="${slot}"]`).evaluate((cell) => {
    const box = cell.getBoundingClientRect();
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
    await bridge.injectSessionRow({
      session_id: "grid-track-chat",
      agent_id: "codex-acp",
      cwd: "",
    });

    const hostRow = page.locator(".sidebar-host-chrome .sidebar-grid-row").first();
    const scheduledRow = page.locator('.sidebar-scroll-content a.sidebar-grid-row[href*="scheduled"]');
    const projectsHeader = page.locator(".sidebar-section-header.sidebar-grid-row").filter({
      has: page.getByRole("button", { name: "项目", exact: true }),
    });
    const chatsHeader = page.locator(".sidebar-section-header.sidebar-grid-row").filter({
      has: page.getByRole("button", { name: "对话", exact: true }),
    });
    const footerRow = page.locator(".sidebar-footer-chrome .sidebar-grid-row").first();

    await projectsHeader.hover();
    await chatsHeader.hover();

    const sessionRow = page
      .locator(".sidebar-scroll-content .sidebar-grid-row")
      .filter({ hasText: "codex-acp" })
      .first();
    await sessionRow.hover();
    await expect(sessionRow.locator('[data-sidebar-grid="trailing"] .sidebar-row-action')).toBeVisible({
      timeout: 10_000,
    });

    const depth0IconLefts = await Promise.all([
      gridColumnLeft(hostRow, "icon"),
      gridColumnLeft(scheduledRow, "icon"),
      gridColumnLeft(footerRow, "icon"),
    ]);
    const depth0Reference = depth0IconLefts[0];
    for (const left of depth0IconLefts) {
      expect(Math.abs(left - depth0Reference)).toBeLessThanOrEqual(0.75);
    }

    const depth1IconLefts = await Promise.all([
      gridColumnLeft(projectsHeader, "icon"),
      gridColumnLeft(chatsHeader, "icon"),
    ]);
    const depth1Reference = depth1IconLefts[0];
    for (const left of depth1IconLefts) {
      expect(Math.abs(left - depth1Reference)).toBeLessThanOrEqual(0.75);
    }

    const sessionIcon = await gridColumnLeft(sessionRow, "icon");
    expect(Math.abs(sessionIcon - depth1Reference - 16)).toBeLessThanOrEqual(0.75);

    const trailingCenters = await Promise.all([
      gridColumnCenterX(projectsHeader, "trailing"),
      gridColumnCenterX(chatsHeader, "trailing"),
      gridColumnCenterX(sessionRow, "trailing"),
    ]);

    const referenceTrailing = trailingCenters[0];
    for (const center of trailingCenters) {
      expect(Math.abs(center - referenceTrailing)).toBeLessThanOrEqual(0.75);
    }

    const coordinatorRow = page.locator('[data-testid="project-coordinator-row"]').first();
    if (await coordinatorRow.count()) {
      const coordinatorIcon = await gridColumnLeft(coordinatorRow, "icon");
      expect(Math.abs(coordinatorIcon - sessionIcon)).toBeLessThanOrEqual(0.75);
      const coordinatorTrailing = await gridColumnCenterX(coordinatorRow, "trailing");
      expect(Math.abs(coordinatorTrailing - referenceTrailing)).toBeLessThanOrEqual(0.75);
    }
  } finally {
    await cleanup();
  }
});
