import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";
import { seedWorkspacePickerFixture } from "./grouped-command-menu-fit.shared";
import {
  enableAgent,
  hostPickerPanel,
  injectEvent,
  injectSession,
  openRuntimeLocationPicker,
} from "./helpers";
import { startOpenmaCatalogMock } from "./openma-catalog-mock-server";

async function measurePickerRow(row: Locator, nextRow: Locator) {
  const geometry = await row.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const icon = element.querySelector(
      '[data-grouped-command-grid="icon"] svg, [data-grouped-command-grid="icon"] img',
    )?.getBoundingClientRect();
    const label = element.querySelector('[data-grouped-command-grid="label"]') ?? element;
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    let textX: number | null = null;
    let node = walker.nextNode();
    while (node) {
      if (node.textContent?.trim()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const textRect = range.getBoundingClientRect();
        if (textRect.width > 0 && textRect.height > 0) {
          textX = textRect.x - rect.x;
          break;
        }
      }
      node = walker.nextNode();
    }
    return {
      inlinePadding: parseFloat(style.paddingInlineStart),
      blockPadding: parseFloat(style.paddingBlockStart),
      height: rect.height,
      iconX: icon ? icon.x - rect.x : null,
      iconWidth: icon?.width ?? null,
      textX,
    };
  });
  const rowBox = await row.boundingBox();
  const nextBox = await nextRow.boundingBox();
  return {
    ...geometry,
    pitch: rowBox && nextBox ? nextBox.y - rowBox.y : null,
  };
}

test("harness probe placeholder uses shimmer styles", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  const textarea = page.locator("textarea").first();
  await page.evaluate(() => {
    const el = document.querySelector("textarea");
    el?.classList.add("composer-harness-probe-placeholder");
    el?.setAttribute("placeholder", "Checking Codex…");
  });
  const animation = await textarea.evaluate((el) => getComputedStyle(el, "::placeholder").animationName);
  expect(animation).toContain("shimmer-text-sweep");
});

test("sidebar scrollbar thumb resolves paint tokens", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  const token = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--scrollbar-thumb")
      .trim(),
  );
  expect(token.length).toBeGreaterThan(0);
  expect(token).not.toBe("transparent");
});

test("sidebar row hover wash is inset from the rail edge", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  const sidebar = page.locator(".sidebar-navigation").first();
  const box = await sidebar.boundingBox();
  expect(box).not.toBeNull();
  const row = page.getByTestId("sidebar-local-runtime-row");
  await row.hover();
  const insetLeft = await row.evaluate((el) => {
    const sidebar = el.closest(".sidebar-navigation") as HTMLElement;
    const rect = el.getBoundingClientRect();
    const sidebarBox = sidebar.getBoundingClientRect();
    return rect.left - sidebarBox.left;
  });
  expect(insetLeft).toBeGreaterThanOrEqual(6);
  expect(insetLeft).toBeLessThanOrEqual(16);
});

test("new chat row matches session row vertical alignment and shows hover wash", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enableAgent(page, "codex-acp");
  const row = page.locator('[data-sidebar-row="new-chat"]');
  const newChat = page.getByTestId("new-chat-button");
  const rowBox = await row.boundingBox();
  const newChatBox = await newChat.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(newChatBox).not.toBeNull();
  expect(rowBox!.height).toBeGreaterThanOrEqual(27);
  expect(rowBox!.height).toBeLessThanOrEqual(29);
  expect(Math.abs(newChatBox!.y - rowBox!.y)).toBeLessThanOrEqual(0.5);
  const iconBox = await newChat.locator(".sidebar-row-icon").boundingBox();
  expect(iconBox!.y - rowBox!.y).toBeLessThanOrEqual(6);
  const trailing = page.locator('[data-sidebar-row="new-chat"] [data-sidebar-grid="trailing"]');
  await newChat.hover();
  await expect
    .poll(async () => {
      const bg = await newChat.evaluate(
        (el) => getComputedStyle(el, "::before").backgroundColor,
      );
      return bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
    })
    .toBe(true);
  const trailingAlpha = await trailing.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(el).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
  expect(trailingAlpha).toBe(0);
  const washRight = newChatBox!.x + newChatBox!.width;
  const trailingLeft = (await trailing.boundingBox())!.x;
  expect(trailingLeft - washRight).toBeGreaterThan(4);
});

test("host picker draws separator after OpenMA account row", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const mock = await startOpenmaCatalogMock({
    cloudEnvironmentCount: 1,
    tenantSessionCount: 2,
  });
  try {
    await page.evaluate(async (baseUrl) => {
      await window.backchat.openmaLogin(baseUrl);
    }, mock.baseUrl);
    await enableAgent(page, "codex-acp");
    await page.getByTestId("new-chat-button").click();
    const demoHeading = page
      .locator(".sidebar-section-header")
      .filter({ hasText: "Demo" })
      .first();
    await expect(demoHeading).toBeVisible();
    await expect(demoHeading).toHaveAttribute("data-sidebar-leading", "none");
    await demoHeading.click();
    const tenantSection = demoHeading.locator(
      "xpath=ancestor::*[contains(concat(' ',normalize-space(@class),' '),' sidebar-section ')]",
    );
    await expect(
      tenantSection.locator('.sidebar-grid-row[data-sidebar-depth="1"]'),
    ).toHaveCount(3);
    const demoLabelBox = await demoHeading
      .locator('[data-sidebar-grid="label"]')
      .boundingBox();
    const tenantChildIconBox = await tenantSection
      .locator('.sidebar-grid-row[data-sidebar-depth="1"] .sidebar-row-icon')
      .first()
      .boundingBox();
    expect(demoLabelBox).not.toBeNull();
    expect(tenantChildIconBox).not.toBeNull();
    expect(Math.abs(demoLabelBox!.x - 23)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(tenantChildIconBox!.x - demoLabelBox!.x - 16),
    ).toBeLessThanOrEqual(0.5);
    await openRuntimeLocationPicker(page);
    const panel = hostPickerPanel(page);
    const shell = page
      .locator('[data-slot="dropdown-menu-content"]')
      .filter({ has: panel });
    await expect(panel.locator('[data-slot="command-separator"]')).toHaveCount(1);
    const padding = await shell.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        top: parseFloat(style.paddingTop),
        bottom: parseFloat(style.paddingBottom),
        borderRadius: parseFloat(style.borderTopLeftRadius),
      };
    });
    expect(padding.top).toBeGreaterThanOrEqual(3.5);
    expect(padding.top).toBeLessThanOrEqual(4.5);
    expect(padding.bottom).toBe(padding.top);
    expect(padding.borderRadius).toBeGreaterThanOrEqual(7);
    await expect(panel.getByRole("option").filter({ hasNotText: /Manage|管理/ })).not.toHaveCount(0);
    const manage = panel.getByRole("option", { name: /Manage OpenMA|管理 OpenMA/i });
    const separatorsBetweenLocationsAndManage = await manage.evaluate((el) => {
      let node = el.previousElementSibling;
      let count = 0;
      while (node) {
        if (node.getAttribute("data-slot") === "command-separator") count += 1;
        if (node.getAttribute("role") === "option") break;
        node = node.previousElementSibling;
      }
      return count;
    });
    expect(separatorsBetweenLocationsAndManage).toBe(0);
    const shellBox = await shell.boundingBox();
    expect(shellBox).not.toBeNull();
    expect(Math.abs(shellBox!.height - 143)).toBeLessThanOrEqual(1);
    expect(Math.abs(shellBox!.y - 618)).toBeLessThanOrEqual(1);
    const triggerBox = await page
      .locator('[data-composer-footer-control="runtime"]')
      .first()
      .boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(Math.abs(triggerBox!.y - (shellBox!.y + shellBox!.height))).toBeLessThanOrEqual(1);
    const borderWidth = await shell.evaluate((el) =>
      parseFloat(getComputedStyle(el).borderTopWidth),
    );
    expect(borderWidth).toBeGreaterThanOrEqual(0.5);
    expect(borderWidth).toBeLessThanOrEqual(1.5);
    const separator = panel.locator('[data-slot="command-separator"]').first();
    const separatorBox = await separator.boundingBox();
    const shellPads = await shell.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        left: parseFloat(style.paddingLeft),
        right: parseFloat(style.paddingRight),
        border: parseFloat(style.borderLeftWidth),
      };
    });
    const innerWidth =
      shellBox!.width - shellPads.left - shellPads.right - shellPads.border * 2;
    expect(separatorBox!.width).toBeGreaterThanOrEqual(innerWidth - 2);
    expect(separatorBox!.width).toBeLessThanOrEqual(shellBox!.width);
    const firstRow = panel.locator('[cmdk-item]').nth(1);
    const rowBoxes = await Promise.all([
      firstRow.boundingBox(),
      panel.locator('[cmdk-item]').nth(2).boundingBox(),
    ]);
    expect(rowBoxes[0]).not.toBeNull();
    expect(rowBoxes[1]).not.toBeNull();
    expect(Math.abs(rowBoxes[1]!.y - rowBoxes[0]!.y - 28)).toBeLessThanOrEqual(1);
    const rowPadding = await firstRow.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        block: parseFloat(style.paddingTop),
        gap: parseFloat(style.columnGap),
      };
    });
    expect(rowPadding.block).toBe(4);
    expect(rowPadding.gap).toBe(6);
    const rowInset = await firstRow.evaluate((el) => {
      const shellRect = el
        .closest('[data-slot="dropdown-menu-content"]')!
        .getBoundingClientRect();
      const rowRect = el.getBoundingClientRect();
      return rowRect.left - shellRect.left;
    });
    expect(rowInset).toBeGreaterThanOrEqual(4);
    expect(rowInset).toBeLessThanOrEqual(6.5);
  } finally {
    await mock.close();
  }
});

test("model picker search hides empty provider headings", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "model-heading-filter",
    event: {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "devin-1",
          options: [
            {
              group: "anthropic",
              name: "anthropic-proxy",
              options: [{ value: "anthropic-proxy-0", name: "anthropic-proxy model 0" }],
            },
            {
              group: "openai",
              name: "openai-codex",
              options: [{ value: "openai-codex-0", name: "openai-codex model 0" }],
            },
            {
              group: "devin",
              name: "devin",
              options: [{ value: "devin-1", name: "devin model 1" }],
            },
          ],
        },
      ],
    },
  });
  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
  const panel = page.getByTestId("composer-select-menu-panel");
  const search = panel.locator('input[type="search"], input[cmdk-input]');
  await search.fill("devin model 1");
  await expect
    .poll(async () => panel.getByText("anthropic-proxy", { exact: true }).count())
    .toBe(0);
  await expect(panel.getByText("openai-codex", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("option", { name: /devin model 1/ })).toBeVisible({
    timeout: 10_000,
  });
});

test("model picker keeps provider heading while searching", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: "model-heading-visible",
    event: {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "devin-1",
          options: [
            {
              group: "devin",
              name: "devin",
              options: [{ value: "devin-1", name: "devin model 1" }],
            },
          ],
        },
      ],
    },
  });
  await page.getByRole("button", { name: /Run on|运行位置/ }).first().click();
  await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
  const panel = page.getByTestId("composer-select-menu-panel");
  const heading = panel.locator("[data-grouped-command-group-heading]", {
    hasText: "devin",
  });
  await panel.locator('input[type="search"], input[cmdk-input]').fill("devin model 1");
  await expect(heading).toBeVisible();
});

test("selected session row stays opaque on hover", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  await injectSession(page, {
    agentId: "codex-acp",
    cwd: "/tmp/backchat-selected-hover",
  });
  const row = page.locator(".sidebar-grid-row.app-selected-surface").first();
  const selectedWeight = await row
    .locator('[data-sidebar-grid="label"]')
    .evaluate((el) => Number.parseInt(getComputedStyle(el).fontWeight, 10));
  expect(selectedWeight).toBe(500);
  await row.hover();
  const alpha = await row.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(el).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
  expect(alpha).toBe(255);
});

test("project sessions share the coordinator grid without clipping", async ({ page }) => {
  await injectSession(page, {
    sessionId: "pr56-grid-alignment",
    agentId: "codex-acp",
    cwd: "/tmp/pr56-grid-alignment",
  });
  const navigation = page.getByRole("navigation");
  const coordinator = navigation.getByTestId("project-coordinator-row").first();
  const sessionActions = navigation.getByRole("button", {
    name: "Session actions",
    exact: true,
  });
  await expect(coordinator).toBeVisible();
  await expect(sessionActions).toBeAttached();

  const [coordinatorIcon, sessionIcon] = await Promise.all([
    coordinator.locator('[data-sidebar-grid="icon"]').boundingBox(),
    sessionActions
      .locator("xpath=ancestor::div[contains(@class,'sidebar-grid-row')]")
      .locator('[data-sidebar-grid="icon"]')
      .boundingBox(),
  ]);
  expect(coordinatorIcon).not.toBeNull();
  expect(sessionIcon).not.toBeNull();
  expect(Math.abs(sessionIcon!.x - coordinatorIcon!.x)).toBeLessThanOrEqual(0.5);

  const projectActions = navigation.getByRole("button", {
    name: "Project actions",
    exact: true,
  });
  const projectRow = projectActions.locator(
    "xpath=ancestor::div[contains(@class,'sidebar-grid-row')]",
  );
  const sessionRow = sessionActions.locator(
    "xpath=ancestor::div[contains(@class,'sidebar-grid-row')]",
  );
  const [projectGlyph, coordinatorGlyph, sessionGlyph] = await Promise.all([
    projectRow.locator(".sidebar-row-icon > *").first().boundingBox(),
    coordinator.locator(".sidebar-coordinator-icon > *").first().boundingBox(),
    sessionRow.locator(".sidebar-row-icon > *").first().boundingBox(),
  ]);
  expect(projectGlyph).not.toBeNull();
  expect(coordinatorGlyph).not.toBeNull();
  expect(sessionGlyph).not.toBeNull();
  const nestStep = await navigation.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).getPropertyValue("--sidebar-grid-nest-step")),
  );
  expect(Math.abs(coordinatorGlyph!.x - projectGlyph!.x - nestStep)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(sessionGlyph!.x - projectGlyph!.x - nestStep)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(sessionGlyph!.x - coordinatorGlyph!.x)).toBeLessThanOrEqual(0.5);

  const labelMetrics = await coordinator
    .locator('[data-sidebar-grid="label"]')
    .evaluate((label) => {
      const row = label.closest(".sidebar-grid-row")!;
      const rowRect = row.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const style = getComputedStyle(row);
      return {
        width: labelRect.width,
        contentRight: rowRect.right - parseFloat(style.paddingRight),
        labelRight: labelRect.right,
      };
    });
  expect(Math.abs(labelMetrics.width - 148), JSON.stringify(labelMetrics)).toBeLessThanOrEqual(2);
  expect(Math.abs(labelMetrics.labelRight - labelMetrics.contentRight)).toBeLessThanOrEqual(1);
});

test("capture acceptance evidence @pr56", async ({ page }) => {
  test.skip(!process.env.PR56_CAPTURE, "set PR56_CAPTURE=1 to export screenshots");
  test.setTimeout(180_000);
  const { mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = "/opt/cursor/artifacts/pr56-acceptance";
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await enableAgent(page, "codex-acp");
  const newChat = page.getByTestId("new-chat-button");
  await newChat.hover();
  await page.screenshot({
    path: join(dir, "new-chat-hover-after.png"),
    clip: { x: 0, y: 40, width: 320, height: 90 },
  });
  const mock = await startOpenmaCatalogMock({ cloudEnvironmentCount: 1 });
  try {
    await page.evaluate(async (baseUrl) => {
      await window.backchat.openmaLogin(baseUrl);
    }, mock.baseUrl);
    await page.getByTestId("new-chat-button").click();
    await openRuntimeLocationPicker(page);
    const panel = hostPickerPanel(page);
    const shell = page
      .locator('[data-slot="dropdown-menu-content"]')
      .filter({ has: panel });
    const box = await shell.boundingBox();
    await page.screenshot({
      path: join(dir, "host-picker-after.png"),
      clip: {
        x: Math.max(0, box!.x - 8),
        y: Math.max(0, box!.y - 8),
        width: box!.width + 16,
        height: box!.height + 16,
      },
    });
  } finally {
    await mock.close();
  }
});

test("project picker search keeps cmdk best-match order for re", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await page.locator('[data-composer-footer-control="project"]').click();
  const panel = page.getByTestId("composer-project-picker-panel");
  const search = panel.locator('input[type="search"], input[cmdk-input]');
  await search.fill("re");
  const firstOption = panel.locator('[cmdk-item]:not([aria-disabled="true"])').first();
  await expect(firstOption).toContainText(/No project|无项目/i);
});

test("project picker bounds long results and fits a short query", async ({
  page,
  home,
}) => {
  await page.setViewportSize({ width: 900, height: 560 });
  const projects = Array.from({ length: 25 }, (_, index) => {
    const id = `picker-overflow-${String(index).padStart(2, "0")}`;
    const directory = join(home, id);
    return {
      project_id: id,
      name:
        index === 24
          ? "Unique Target Signal"
          : `Picker Overflow ${String(index).padStart(2, "0")}`,
      source_folders: [directory],
      primary_folder: directory,
    };
  });
  await Promise.all(
    projects.map((project) => mkdir(project.primary_folder, { recursive: true })),
  );
  await page.evaluate(async (seededProjects) => {
    localStorage.setItem("backchat:workspace-intro-seen:v1", "1");
    await Promise.all(
      seededProjects.map((project) => window.backchat.projectSave(project)),
    );
  }, projects);
  await page.reload();
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await page.locator('[data-composer-footer-control="project"]').click();

  const panel = page.getByTestId("composer-project-picker-panel");
  const popover = panel.locator("xpath=ancestor::*[@data-slot='popover-content'][1]");
  const search = panel.locator('input[cmdk-input]');
  const list = panel.locator('[data-slot="command-list"]');
  await expect(popover).toBeVisible();
  await expect(search).toBeVisible();

  const initial = await popover.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const list = element.querySelector('[data-slot="command-list"]') as HTMLElement;
    const input = element.querySelector('[data-slot="command-input-wrapper"]');
    return {
      panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      inside: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      searchVisible: !!input && input.getBoundingClientRect().height > 0,
      listScrollHeight: list.scrollHeight,
      listClientHeight: list.clientHeight,
      listOverflowY: getComputedStyle(list).overflowY,
    };
  });
  expect(initial.inside).toBe(true);
  expect(initial.searchVisible).toBe(true);
  expect(initial.listScrollHeight).toBeGreaterThan(initial.listClientHeight);
  expect(["auto", "scroll"]).toContain(initial.listOverflowY);
  const projectTriggerBox = await page
    .locator('[data-composer-footer-control="project"]')
    .boundingBox();
  const projectPopoverBox = await popover.boundingBox();
  const projectGap = projectTriggerBox!.y - (projectPopoverBox!.y + projectPopoverBox!.height);
  expect(Math.abs(projectGap)).toBeLessThanOrEqual(0.5);
  const projectRows = list
    .locator('[cmdk-item]:not([aria-disabled="true"])')
    .filter({ hasText: /Picker Overflow/ });
  const projectRow = await measurePickerRow(projectRows.nth(0), projectRows.nth(1));
  console.log(`[project picker row geometry] ${JSON.stringify(projectRow)}`);
  expect(projectRow).toMatchObject({
    inlinePadding: 8,
    blockPadding: 6,
    height: 28,
    pitch: 28,
    iconX: 8,
    iconWidth: 16,
    textX: 32,
  });

  await search.fill("Unique Target Signal");
  const shortResults = await list
    .locator('[cmdk-item]:not([aria-disabled="true"])')
    .count();
  const matchingProjects = await list
    .locator('[cmdk-item]:not([aria-disabled="true"])')
    .filter({ hasText: "Unique Target Signal" })
    .count();
  expect(shortResults).toBeGreaterThanOrEqual(1);
  expect(shortResults).toBeLessThanOrEqual(2);
  expect(matchingProjects).toBe(1);
  await expect.poll(async () => (await popover.boundingBox())?.height ?? Infinity)
    .toBeLessThan(160);
});

test("workspace picker bounds many worktrees and fits a short query", async ({
  page,
  home,
}) => {
  test.setTimeout(120_000);
  await seedWorkspacePickerFixture(page, home);
  await page.evaluate(async () => {
    for (let index = 0; index < 25; index += 1) {
      const suffix = String(index).padStart(2, "0");
      await window.backchat.workspaceCreate({
        project_id: "workspace-fit-project",
        name:
          index === 24
            ? "Unique Workspace Signal"
            : `Workspace Overflow ${suffix}`,
        branch: `backchat/picker-overflow-${suffix}`,
      });
    }
  });
  await page.reload();
  await page.setViewportSize({ width: 900, height: 560 });
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: "Workspace fit", exact: true }).click();
  const workspaceTrigger = page.locator('[data-composer-footer-control="workspace"]');
  await workspaceTrigger.click();

  const panel = page.getByTestId("composer-workspace-picker-panel");
  const popover = panel.locator("xpath=ancestor::*[@data-slot='popover-content'][1]");
  const search = panel.locator('input[cmdk-input]');
  const list = panel.locator('[data-slot="command-list"]');
  await expect(popover).toBeVisible();
  await expect(search).toBeVisible();

  const initial = await popover.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const list = element.querySelector('[data-slot="command-list"]') as HTMLElement;
    const input = element.querySelector('[data-slot="command-input-wrapper"]');
    return {
      panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      inside: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      searchVisible: !!input && input.getBoundingClientRect().height > 0,
      listScrollHeight: list.scrollHeight,
      listClientHeight: list.clientHeight,
      listOverflowY: getComputedStyle(list).overflowY,
    };
  });
  expect(initial.inside).toBe(true);
  expect(initial.searchVisible).toBe(true);
  expect(initial.listScrollHeight).toBeGreaterThan(initial.listClientHeight);
  expect(["auto", "scroll"]).toContain(initial.listOverflowY);
  const workspaceTriggerBox = await page
    .locator('[data-composer-footer-control="workspace"]')
    .boundingBox();
  const workspacePopoverBox = await popover.boundingBox();
  const workspaceGap = workspaceTriggerBox!.y -
    (workspacePopoverBox!.y + workspacePopoverBox!.height);
  expect(Math.abs(workspaceGap)).toBeLessThanOrEqual(0.5);
  const workspaceRows = list
    .locator('[cmdk-item]:not([aria-disabled="true"])')
    .filter({ hasText: /Workspace Overflow/ });
  const workspaceRow = await measurePickerRow(workspaceRows.nth(0), workspaceRows.nth(1));
  console.log(`[workspace picker row geometry] ${JSON.stringify(workspaceRow)}`);
  expect(workspaceRow).toMatchObject({
    inlinePadding: 8,
    blockPadding: 6,
    height: 28,
    pitch: 28,
    iconX: 8,
    iconWidth: 16,
    textX: 32,
  });

  await search.fill("Unique Workspace Signal");
  const shortResults = await list
    .locator('[cmdk-item]:not([aria-disabled="true"])')
    .count();
  const matchingWorkspaces = await list
    .locator('[cmdk-item]:not([aria-disabled="true"])')
    .filter({ hasText: "Unique Workspace Signal" })
    .count();
  expect(shortResults).toBeGreaterThanOrEqual(1);
  expect(shortResults).toBeLessThanOrEqual(2);
  expect(matchingWorkspaces).toBe(1);
  await expect.poll(async () => (await popover.boundingBox())?.height ?? Infinity)
    .toBeLessThan(160);
});

test("new chat hover wash matches the shared mesh button box", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enableAgent(page, "codex-acp");
  const newChat = page.getByTestId("new-chat-button");
  await newChat.hover();
  const wash = await newChat.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const bcs = getComputedStyle(el, "::before");
    return {
      left: r.left + parseFloat(bcs.left),
      right: r.right - parseFloat(bcs.right),
      top: r.top + parseFloat(bcs.top),
      bottom: r.bottom - parseFloat(bcs.bottom),
      bg: bcs.backgroundColor,
      elementBg: getComputedStyle(el).backgroundColor,
    };
  });
  // A single shape paints the wash; the button element itself stays transparent.
  expect(wash.elementBg).toBe("rgba(0, 0, 0, 0)");
  expect(wash.bg).not.toBe("rgba(0, 0, 0, 0)");
  // Main's wash ran 15→172 at 28px tall; cells stay on the x22/x46 mesh so the
  // icon keeps a visible gap to the wash's left edge.
  expect(wash.left).toBeGreaterThanOrEqual(14.5);
  expect(wash.left).toBeLessThanOrEqual(15.5);
  expect(wash.right).toBeGreaterThanOrEqual(171.5);
  expect(wash.right).toBeLessThanOrEqual(172.5);
  expect(wash.bottom - wash.top).toBeGreaterThanOrEqual(27);
  expect(wash.bottom - wash.top).toBeLessThanOrEqual(29);
  const iconCell = page.locator('[data-sidebar-row="new-chat"] [data-sidebar-grid="icon"]');
  const labelCell = page.locator('[data-sidebar-row="new-chat"] [data-sidebar-grid="label"]');
  const iconBox = await iconCell.boundingBox();
  const labelBox = await labelCell.boundingBox();
  expect(iconBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(iconBox!.x).toBeGreaterThanOrEqual(21.5);
  expect(iconBox!.x).toBeLessThanOrEqual(22.5);
  expect(labelBox!.x).toBeGreaterThanOrEqual(45.5);
  expect(labelBox!.x).toBeLessThanOrEqual(46.5);
  expect(iconBox!.x - wash.left).toBeGreaterThanOrEqual(6.5);
});

test("host picker panels draw a single framed surface", async ({ page }) => {
  test.setTimeout(120_000);
  const mock = await startOpenmaCatalogMock({ cloudEnvironmentCount: 1 });
  try {
    await page.evaluate(async (baseUrl) => {
      await window.backchat.openmaLogin(baseUrl);
    }, mock.baseUrl);
    await enableAgent(page, "codex-acp");
    await page.getByTestId("new-chat-button").click();

    const assertSingleFrame = async (
      open: () => Promise<void>,
      panel: ReturnType<typeof hostPickerPanel>,
    ) => {
      await open();
      const command = panel.locator('[data-slot="command"], .grouped-command-menu').first();
      const frame = await command.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          border: parseFloat(cs.borderTopWidth),
          shadow: cs.boxShadow,
        };
      });
      // The dropdown shell is the only framed surface; the nested command keeps
      // no border or shadow of its own.
      expect(frame.border).toBe(0);
      expect(frame.shadow).toBe("none");
      // Enabled items must not render in disabled ink. cmdk emits
      // `data-disabled="false"` on enabled items, which a bare `[data-disabled]`
      // presence selector would still paint with `--fg-disabled`.
      const ink = await panel.evaluate((el) => {
        const disabledInk = getComputedStyle(el).getPropertyValue("--fg-disabled").trim()
          || getComputedStyle(document.documentElement).getPropertyValue("--fg-disabled").trim();
        const enabled = Array.from(
          el.querySelectorAll('[cmdk-item][data-disabled="false"], [data-slot="command-item"][data-disabled="false"]'),
        ).slice(0, 8);
        return {
          disabledInk,
          colors: enabled.map((n) => getComputedStyle(n).color),
        };
      });
      // token may be a hex/oklch keyword; compare rgb of a probe element instead
      const probe = await page.evaluate((ink) => {
        const probe = document.createElement("div");
        probe.style.color = ink;
        document.body.appendChild(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        return rgb;
      }, ink.disabledInk);
      for (const color of ink.colors) {
        expect(color).not.toBe(probe);
      }
      const shell = page
        .locator('[data-slot="dropdown-menu-content"]')
        .filter({ has: panel });
      const shellBox = await shell.boundingBox();
      expect(shellBox).not.toBeNull();
      // Rows keep main's ~5px inset from the shell edge.
      const firstRow = panel.locator('[cmdk-item]').first();
      const rowInset = await firstRow.evaluate((el) => {
        const shellRect = el
          .closest('[data-slot="dropdown-menu-content"]')!
          .getBoundingClientRect();
        return el.getBoundingClientRect().left - shellRect.left;
      });
      expect(rowInset).toBeGreaterThanOrEqual(4);
      expect(rowInset).toBeLessThanOrEqual(6.5);
      // The divider spans the shell's content box edge to edge.
      const separator = panel.locator('[data-slot="command-separator"]').first();
      const sepBox = await separator.boundingBox();
      const shellPads = await shell.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          left: parseFloat(style.paddingLeft),
          right: parseFloat(style.paddingRight),
          border: parseFloat(style.borderLeftWidth),
        };
      });
      const innerWidth =
        shellBox!.width - shellPads.left - shellPads.right - shellPads.border * 2;
      expect(sepBox).not.toBeNull();
      expect(sepBox!.width).toBeGreaterThanOrEqual(innerWidth - 2);
      // Account/manage rows render like main's plain DropdownMenuItems: the
      // label sits at the row's padding inset (no icon-track indent) at the
      // default item size (14px), not the grid rows' 12px label-column offset.
      const plainRows = panel.locator(".grouped-command-plain-item");
      expect(await plainRows.count()).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < (await plainRows.count()); i++) {
        const metrics = await plainRows.nth(i).evaluate((el) => {
          const shellRect = el
            .closest('[data-slot="dropdown-menu-content"]')!
            .getBoundingClientRect();
          const textEl = Array.from(el.querySelectorAll("span,div")).find(
            (c) => c.textContent?.trim() && c.children.length === 0,
          );
          return {
            labelInset: (textEl ?? el).getBoundingClientRect().left - shellRect.left,
            fontSize: parseFloat(getComputedStyle(textEl ?? el).fontSize),
          };
        });
        expect(metrics.labelInset).toBeGreaterThanOrEqual(10);
        expect(metrics.labelInset).toBeLessThanOrEqual(16);
        expect(metrics.fontSize).toBeGreaterThanOrEqual(13.5);
        expect(metrics.fontSize).toBeLessThanOrEqual(14.5);
      }
      await page.keyboard.press("Escape");
      await expect(shell).toBeHidden();
    };

    await assertSingleFrame(
      () => openRuntimeLocationPicker(page),
      hostPickerPanel(page),
    );
    await assertSingleFrame(
      async () => {
        await page.getByTestId("sidebar-local-runtime-row").click();
        await expect(page.getByTestId("sidebar-host-picker-panel")).toBeVisible({
          timeout: 10_000,
        });
      },
      page.getByTestId("sidebar-host-picker-panel"),
    );
  } finally {
    await mock.close();
  }
});

test("composer footer menus open upward inside a short window", async ({ page }) => {
  test.setTimeout(120_000);
  const mock = await startOpenmaCatalogMock({ cloudEnvironmentCount: 1 });
  try {
    await page.evaluate(async (baseUrl) => {
      await window.backchat.openmaLogin(baseUrl);
    }, mock.baseUrl);
    await enableAgent(page, "codex-acp");
    await page.getByTestId("new-chat-button").click();
    await page.setViewportSize({ width: 900, height: 560 });

    const viewportH = await page.evaluate(() => window.innerHeight);
    const expectInsideWindow = async (
      content: ReturnType<typeof page.locator>,
      label: string,
    ) => {
      await expect(content).toBeVisible({ timeout: 10_000 });
      const box = await content.boundingBox();
      expect(box, `${label} bounds`).not.toBeNull();
      expect(box!.y, `${label} top inside window`).toBeGreaterThanOrEqual(0);
      expect(
        box!.y + box!.height,
        `${label} bottom inside window`,
      ).toBeLessThanOrEqual(viewportH);
      const side = await content.getAttribute("data-side");
      expect(side, `${label} opens upward`).toBe("top");
    };

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate(async (theme) => {
        const current = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          appearance: { ...current.appearance, theme },
        });
      }, theme);
      for (const control of ["runtime", "project", "workspace"] as const) {
        const trigger = page.locator(`[data-composer-footer-control="${control}"]`);
        if (!(await trigger.isVisible().catch(() => false))) continue;
        await trigger.click();
        const content = page.locator(
          '[data-slot="dropdown-menu-content"], [data-slot="popover-content"]',
        ).last();
        await expectInsideWindow(content, `footer ${control} menu`);
        const openStyle = await trigger.evaluate((el) => {
          const style = getComputedStyle(el);
        return {
          outlineStyle: style.outlineStyle,
          boxShadow: style.boxShadow,
        };
      });
        expect(openStyle.outlineStyle).toBe("none");
        expect(openStyle.boxShadow).toBe("none");
        await page.keyboard.press("Escape");
        await expect(content).toBeHidden();
      }

      const runTrigger = page.locator("[data-composer-run-trigger]");
      await runTrigger.click();
      const runStyle = await runTrigger.evaluate((el) => {
        const style = getComputedStyle(el);
        return { outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
      });
      expect(runStyle.outlineStyle).toBe("none");
      expect(runStyle.boxShadow).toBe("none");
      const runMenu = page
        .locator('[data-slot="dropdown-menu-content"]')
        .first();
      await expectInsideWindow(runMenu, "harness/agent menu");

      const subTrigger = runMenu.locator('[data-slot="dropdown-menu-sub-trigger"]').first();
      await subTrigger.hover();
      const subMenu = page.locator('[data-slot="dropdown-menu-sub-content"]').first();
      await expect(subMenu).toBeVisible({ timeout: 10_000 });
      const [menuBox, subBox] = await Promise.all([
        runMenu.boundingBox(),
        subMenu.boundingBox(),
      ]);
      expect(subBox).not.toBeNull();
      expect(subBox!.y + subBox!.height).toBeLessThanOrEqual(viewportH);
      expect(
        Math.abs(menuBox!.y + menuBox!.height - (subBox!.y + subBox!.height)),
      ).toBeLessThanOrEqual(3);
      const subStyles = await subMenu.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { overflow: cs.overflowY, maxHeight: cs.maxHeight };
      });
      expect(subStyles.overflow).toMatch(/hidden|auto/);
      expect(subStyles.maxHeight).not.toBe("none");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      const footerChips = page.locator("button.composer-footer-trigger");
      for (let index = 0; index < await footerChips.count(); index += 1) {
        const chip = footerChips.nth(index);
        if (
          !(await chip.isVisible().catch(() => false))
          || !(await chip.isEnabled().catch(() => false))
        ) {
          continue;
        }
        await chip.click();
        await expect(chip).toHaveAttribute("data-state", "open");
        const style = await chip.evaluate((el) => {
          const computed = getComputedStyle(el);
          return {
            outlineStyle: computed.outlineStyle,
            boxShadow: computed.boxShadow,
          };
        });
        expect(style.outlineStyle).toBe("none");
        expect(style.boxShadow).toBe("none");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
    }
  } finally {
    await mock.close();
  }
});
