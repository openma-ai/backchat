import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { enableAgent, injectSession } from "./helpers";

test("right sidebar opens resources from a temporary New tab page", async ({ page, home, bridge, capture, app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enableAgent(page, "codex-acp");
  const workspace = join(home, "workspace");
  const presentation = join(workspace, "release-notes.pptx");
  await mkdir(workspace, { recursive: true });
  await writeFile(presentation, "pptx");
  const sessionId = "e2e-right-panel";
  await bridge.persistSessionFixture({
    sessionId,
    agentId: "codex-acp",
    cwd: workspace,
    acpSessionId: "acp-right-panel",
    title: "Right panel source",
    events: [{ type: "user_prompt", data: { text: "Build release notes" } }],
  });
  await injectSession(page, {
    sessionId,
    agentId: "codex-acp",
    cwd: workspace,
  });
  await bridge.injectSessionEvent({
    type: "session.event",
    session_id: sessionId,
    turn_id: "e2e-output-turn",
    event: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "" },
    },
  });
  await bridge.injectSessionEvent({
    type: "session.event",
    session_id: sessionId,
    turn_id: "e2e-output-turn",
    event: {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: `:codex-file-citation{path="${presentation}" purpose="output"}`,
      },
    },
  });
  await bridge.injectSessionEvent({
    type: "session.complete",
    session_id: sessionId,
    turn_id: "e2e-output-turn",
  });
  await page.evaluate(async ({ sourceSessionId, cwd }) => {
    await window.backchat.schedulesCreate({
      name: "Refresh release notes",
      prompt: "Refresh the release notes from the latest sources.",
      trigger: {
        type: "at",
        at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      target: "current_task",
      sourceSessionId,
      agentId: "codex-acp",
      cwd,
    });
  }, { sourceSessionId: sessionId, cwd: workspace });

  const zoomFactor = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor(),
  );
  expect(zoomFactor).toBe(1.15);

  const sidebarToggle = page.getByRole("button", { name: "Collapse sidebar" });
  const sidePanelToggle = page.getByRole("button", {
    name: /(?:Open|Close) side panel/,
  });
  const terminalToggle = page.getByRole("button", { name: "Open terminal" });
  const chromeCenterYs = await Promise.all(
    [sidebarToggle, sidePanelToggle, terminalToggle].map((locator) =>
      locator.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return Math.round(box.y + box.height / 2);
      })),
  );
  expect(Math.max(...chromeCenterYs) - Math.min(...chromeCenterYs)).toBeLessThanOrEqual(1);

  await sidebarToggle.click();
  const expandSidebar = page.getByRole("button", { name: "Expand sidebar" });
  await expect(expandSidebar).toBeVisible();
  const taskTitle = page.locator("header span").first();
  const collapsedTitleGap = await Promise.all([
    expandSidebar.evaluate((element) => element.getBoundingClientRect().right),
    taskTitle.evaluate((element) => element.getBoundingClientRect().left),
  ]).then(([buttonRight, titleLeft]) => titleLeft - buttonRight);
  expect(collapsedTitleGap).toBeGreaterThanOrEqual(11);
  await expandSidebar.click();
  await expect(sidebarToggle).toBeVisible();

  const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
  if (!(await closeSidePanel.isVisible())) {
    await page.getByRole("button", { name: "Open side panel" }).click();
  }
  await expect(closeSidePanel).toBeVisible();

  const panel = page.locator("aside[data-right-panel-expanded]");
  await page.getByRole("button", { name: "Expand panel" }).click();
  await expect(panel).toHaveAttribute("data-right-panel-expanded", "true");
  const expandedRadii = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      topLeft: Number.parseFloat(style.borderTopLeftRadius),
      bottomLeft: Number.parseFloat(style.borderBottomLeftRadius),
      topRight: Number.parseFloat(style.borderTopRightRadius),
    };
  });
  expect(expandedRadii.topLeft).toBe(0);
  expect(expandedRadii.bottomLeft).toBe(0);
  expect(expandedRadii.topRight).toBeGreaterThan(0);
  const pinnedMainSession = panel.locator('[data-pinned-main-session="true"]');
  await expect(pinnedMainSession).toBeVisible();
  await expect(page.getByRole("button", { name: "Open terminal" })).toBeHidden();
  await expect.poll(async () => page.evaluate(() => {
    const sidebar = document.querySelector("aside.theme-sidebar-background");
    const expandedPanel = document.querySelector('aside[data-right-panel-expanded="true"]');
    if (!(sidebar instanceof HTMLElement) || !(expandedPanel instanceof HTMLElement)) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.abs(
      expandedPanel.getBoundingClientRect().left
        - sidebar.getBoundingClientRect().right,
    );
  })).toBeLessThanOrEqual(1);
  const expandedGeometry = await page.evaluate(() => {
    const sidebar = document.querySelector("aside.theme-sidebar-background");
    const expandedPanel = document.querySelector('aside[data-right-panel-expanded="true"]');
    if (!(sidebar instanceof HTMLElement) || !(expandedPanel instanceof HTMLElement)) {
      throw new Error("Expanded panel geometry is unavailable");
    }
    const sidebarBox = sidebar.getBoundingClientRect();
    const panelBox = expandedPanel.getBoundingClientRect();
    const stageInset = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--stage-inset"),
    );
    return {
      leftGap: panelBox.left - sidebarBox.right,
      rightGap: window.innerWidth - panelBox.right,
      stageInset,
    };
  });
  expect(Math.abs(expandedGeometry.leftGap)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(expandedGeometry.rightGap - expandedGeometry.stageInset),
  ).toBeLessThanOrEqual(1);
  const expandedHeaderTops = await Promise.all([
    pinnedMainSession,
    panel.getByRole("tablist").locator(":scope > span[aria-hidden='true']"),
    panel.getByRole("button", { name: "New tab", exact: true }),
    panel.getByRole("button", { name: "Restore split view" }),
  ].map((locator) => locator.evaluate(
    (element) => Math.round(element.getBoundingClientRect().top * 10) / 10,
  )));
  expect(
    Math.max(...expandedHeaderTops) - Math.min(...expandedHeaderTops),
  ).toBeLessThanOrEqual(0.5);
  await capture("right-panel-expanded.png", "expanded right-panel workspace");

  await pinnedMainSession.click();
  await expect(panel).toHaveAttribute("data-expanded-surface", "main");
  await expect(page.getByPlaceholder("Reply…")).toBeVisible();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(panel).toHaveAttribute("data-expanded-surface", "panel");
  await expect(page.getByRole("heading", { name: "Outputs" })).toBeVisible();
  await pinnedMainSession.click();
  await expect(panel).toHaveAttribute("data-expanded-surface", "main");
  await page.getByRole("button", { name: "Restore split view" }).click();
  await expect(panel).toHaveAttribute("data-right-panel-expanded", "false");
  await expect(page.getByRole("button", { name: "Expand panel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open terminal" })).toBeVisible();

  const newTabButton = page.getByRole("button", { name: "New tab", exact: true });
  await expect(page.getByRole("tab", { name: "New tab", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Context fork" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Files", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Browser" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Terminal", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outputs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Background" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sources" })).toHaveCount(0);
  await expect(
    page.locator('[data-resource-category="outputs"]').getByRole(
      "button",
      { name: /release-notes\.pptx/ },
    ),
  ).toBeVisible();
  const registeredTask = page.getByRole("button", { name: /Refresh release notes/ });
  await expect(registeredTask).toBeVisible({ timeout: 5_000 });
  const launcherAnchorXs = await page.locator("[data-launcher-label]").evaluateAll(
    (elements) => elements.map(
      (element) => Math.round(element.getBoundingClientRect().x),
    ),
  );
  expect(new Set(launcherAnchorXs).size).toBe(1);
  const launcherIconCenterXs = await page.locator(
    "[data-new-action] > span:first-child, [data-resource-category] button > span:first-child",
  ).evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return Math.round(box.x + box.width / 2);
  }));
  expect(new Set(launcherIconCenterXs).size).toBe(1);
  const [sectionHeaderXs, launcherGlyphLeftXs] = await Promise.all([
    page.locator("[data-resource-category] h2").evaluateAll(
      (elements) => elements.map(
        (element) => Math.round(element.getBoundingClientRect().x),
      ),
    ),
    page.locator(
      "[data-new-action] > span:first-child svg, [data-resource-category] button > span:first-child svg",
    ).evaluateAll((elements) => elements.map(
      (element) => Math.round(element.getBoundingClientRect().x),
    )),
  ]);
  expect(new Set(sectionHeaderXs).size).toBe(1);
  expect(new Set(launcherGlyphLeftXs).size).toBe(1);
  expect(sectionHeaderXs[0]).toBe(launcherGlyphLeftXs[0]);

  await registeredTask.click();
  await expect(page.getByRole("tab", { name: "Refresh release notes" })).toBeVisible();
  await expect(
    page.getByText("Refresh the release notes from the latest sources."),
  ).toBeVisible();

  await newTabButton.click();
  await expect(page.getByRole("tab", { name: "New tab", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /release-notes\.pptx/ }).click();
  await expect(page.getByRole("tab", { name: "release-notes.pptx" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open file" })).toBeVisible();
  const [scheduleTabWidth, artifactTabWidth] = await Promise.all([
    page.getByRole("tab", { name: "Refresh release notes" }).evaluate(
      (element) => element.parentElement!.getBoundingClientRect().width,
    ),
    page.getByRole("tab", { name: "release-notes.pptx" }).evaluate(
      (element) => element.parentElement!.getBoundingClientRect().width,
    ),
  ]);
  expect(scheduleTabWidth).toBe(artifactTabWidth);
  expect(scheduleTabWidth).toBeCloseTo(128, 1);
  const inactiveTabTrailingGap = await page.getByRole(
    "tab",
    { name: "Refresh release notes" },
  ).evaluate((element) => {
    const tab = element.getBoundingClientRect();
    const chip = element.parentElement!.getBoundingClientRect();
    return chip.right - tab.right;
  });
  expect(inactiveTabTrailingGap).toBeLessThanOrEqual(4);

  await newTabButton.click();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByRole("tab", { name: "workspace" })).toBeVisible();

  await newTabButton.click();
  await expect(page.getByRole("heading", { name: "Outputs" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "New tab", exact: true })).toHaveCount(0);

  await capture("right-panel-new-tab.png", "right sidebar New tab workspace");
});

test("right-panel expansion belongs to each main session", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enableAgent(page, "codex-acp");
  const firstSessionId = "alpha-panel";
  const secondSessionId = "bravo-panel";
  await injectSession(page, {
    sessionId: firstSessionId,
    agentId: "codex-acp",
    cwd: "/tmp/alpha-panel",
  });

  const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
  if (!(await closeSidePanel.isVisible())) {
    await page.getByRole("button", { name: "Open side panel" }).click();
  }
  const panel = page.locator("aside[data-right-panel-expanded]");
  await page.getByRole("button", { name: "Expand panel" }).click();
  await expect(panel).toHaveAttribute("data-right-panel-expanded", "true");

  await injectSession(page, {
    sessionId: secondSessionId,
    agentId: "codex-acp",
    cwd: "/tmp/bravo-panel",
  });
  await expect(panel).toHaveAttribute("data-right-panel-expanded", "false");
  await expect(page.getByRole("button", { name: "Expand panel" })).toBeVisible();

  await page.getByRole("button", {
    name: `codex-acp · ${firstSessionId.slice(0, 6)}`,
  }).click();
  await expect(panel).toHaveAttribute("data-right-panel-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Restore split view" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore split view" }).click();
  await expect(panel).toHaveAttribute("data-right-panel-expanded", "false");
  await page.getByRole("button", { name: "Close side panel" }).click();
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("button", { name: "Open side panel" })).toBeVisible();
});
