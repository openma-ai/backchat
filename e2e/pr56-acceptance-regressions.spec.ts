import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
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
      '[data-grouped-command-grid="icon"]',
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

async function measureFooterTrigger(trigger: Locator) {
  return trigger.evaluate((element) => {
    const iconSlot = element.querySelector("[data-control-icon]");
    const label = Array.from(element.children).find(
      (child) => !child.hasAttribute("data-control-icon") &&
        !child.hasAttribute("data-control-chevron"),
    );
    const rect = element.getBoundingClientRect();
    const iconSlotRect = iconSlot?.getBoundingClientRect();
    const labelRect = label?.getBoundingClientRect();
    const style = getComputedStyle(element);
    const labelStyle = label ? getComputedStyle(label) : style;
    const chevron = element.querySelector("[data-control-chevron]");
    return {
      x: rect.x,
      right: rect.right,
      iconOffsetX: iconSlotRect ? iconSlotRect.x - rect.x : null,
      iconSlotRight: iconSlotRect?.right ?? null,
      iconSlotWidth: iconSlotRect?.width ?? null,
      iconSlotHeight: iconSlotRect?.height ?? null,
      labelOffset: iconSlotRect && labelRect
        ? labelRect.x - iconSlotRect.right
        : null,
      controlHeight: parseFloat(
        style.getPropertyValue("--control-height-compact"),
      ),
      paddingInlineStart: parseFloat(style.paddingInlineStart),
      paddingInlineEnd: parseFloat(style.paddingInlineEnd),
      gap: parseFloat(style.columnGap || style.gap),
      labelColor: labelStyle.color,
      labelWeight: labelStyle.fontWeight,
      chevronColor: chevron ? getComputedStyle(chevron).color : null,
      backgroundColor: style.backgroundColor,
    };
  });
}

function footerTriggerMatchesLayout(
  chip: Awaited<ReturnType<typeof measureFooterTrigger>>,
  mutedColor: string,
) {
  return chip.iconOffsetX === 0
    && chip.iconSlotWidth === chip.controlHeight
    && chip.iconSlotHeight === chip.controlHeight
    && chip.labelOffset === chip.gap
    && chip.paddingInlineStart === 0
    && chip.paddingInlineEnd === 6
    && chip.gap === 2
    && chip.labelWeight === "400"
    && chip.labelColor === mutedColor
    && chip.chevronColor === mutedColor;
}

async function readColorToken(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

test("harness probe status text runs the shimmer sweep", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  // The probe may settle before we look, so check the class the composer
  // renders on a real element (::placeholder never animates in Chromium).
  const animation = await page.evaluate(() => {
    const el = document.createElement("span");
    el.className = "shimmer-text";
    el.textContent = "Checking Codex…";
    document.body.appendChild(el);
    const name = getComputedStyle(el).animationName;
    el.remove();
    return name;
  });
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
  await expect.poll(() => row.evaluate((el) => {
    const sidebar = el.closest(".sidebar-navigation") as HTMLElement;
    const rect = el.getBoundingClientRect();
    const sidebarBox = sidebar.getBoundingClientRect();
    return rect.left - sidebarBox.left;
  })).toBeGreaterThanOrEqual(6);
  await expect.poll(() => row.evaluate((el) => {
    const sidebar = el.closest(".sidebar-navigation") as HTMLElement;
    const rect = el.getBoundingClientRect();
    const sidebarBox = sidebar.getBoundingClientRect();
    return rect.left - sidebarBox.left;
  })).toBeLessThanOrEqual(16);
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
  await expect.poll(() => trailing.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(el).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  })).toBe(0);
  await expect.poll(async () => {
    const [washBox, trailingBox] = await Promise.all([
      newChat.boundingBox(),
      trailing.boundingBox(),
    ]);
    if (!washBox || !trailingBox) return -Infinity;
    return trailingBox.x - (washBox.x + washBox.width);
  }).toBeGreaterThan(4);
});

test("composer footer chips match main geometry and typography", async ({ page, home }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedWorkspacePickerFixture(page, home);
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: "Workspace fit", exact: true }).click();
  await page.keyboard.press("Escape");

  const mutedColor = await readColorToken(page, "--fg-muted");
  const localTrigger = page.locator('[data-composer-footer-control="runtime"]');
  const projectTrigger = page.locator('[data-composer-footer-control="project"]');
  const workspaceTrigger = page.locator('[data-composer-footer-control="workspace"]');
  await expect.poll(async () => {
    const [local, project, workspace] = await Promise.all([
      measureFooterTrigger(localTrigger),
      measureFooterTrigger(projectTrigger),
      measureFooterTrigger(workspaceTrigger),
    ]);
    return footerTriggerMatchesLayout(local, mutedColor)
      && footerTriggerMatchesLayout(project, mutedColor)
      && footerTriggerMatchesLayout(workspace, mutedColor)
      && project.x - local.right === 2
      && workspace.x - project.right === 2;
  }).toBe(true);
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
    const localRow = page.getByTestId("sidebar-local-runtime-row");
    const mutedColor = await readColorToken(page, "--fg-muted");
    await expect.poll(() =>
      localRow.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          color: style.color,
          iconCount: el.querySelectorAll("svg, img").length,
        };
      }),
    ).toMatchObject({
      x: 15,
      y: 177,
      width: 222,
      height: 28,
      fontSize: "12px",
      fontWeight: "500",
      color: mutedColor,
      iconCount: 0,
    });
    await expect.poll(() =>
      demoHeading
        .locator('[data-sidebar-grid="label"] button')
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            color: style.color,
          };
        }),
    ).toMatchObject({
      fontSize: "12px",
      fontWeight: "500",
      color: mutedColor,
    });
    await demoHeading.click();
    const tenantSection = demoHeading.locator(
      "xpath=ancestor::*[contains(concat(' ',normalize-space(@class),' '),' sidebar-section ')]",
    );
    await expect(
      tenantSection.locator('.sidebar-grid-row[data-sidebar-depth="1"]'),
    ).toHaveCount(3);
    await expect.poll(async () => {
      const [demoLabelBox, tenantChildIconBox] = await Promise.all([
        demoHeading.locator('[data-sidebar-grid="label"]').boundingBox(),
        tenantSection
          .locator('.sidebar-grid-row[data-sidebar-depth="1"] .sidebar-row-icon')
          .first()
          .boundingBox(),
      ]);
      return !!demoLabelBox
        && !!tenantChildIconBox
        && Math.abs(demoLabelBox.x - 23) <= 1
        && Math.abs(tenantChildIconBox.x - 43) <= 0.5;
    }).toBe(true);
    await openRuntimeLocationPicker(page);
    const panel = hostPickerPanel(page);
    const shell = page
      .locator('[data-slot="dropdown-menu-content"]')
      .filter({ has: panel });
    await expect(panel.locator('[data-slot="command-separator"]')).toHaveCount(1);
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
    const separator = panel.locator('[data-slot="command-separator"]').first();
    const firstRow = panel.locator('[cmdk-item]').nth(1);
    const runtimeTrigger = page
      .locator('[data-composer-footer-control="runtime"]')
      .first();
    await expect.poll(async () => {
      const [
        padding,
        shellBox,
        triggerBox,
        borderWidth,
        separatorBox,
        shellPads,
        rowBoxes,
        rowPadding,
        rowInset,
      ] = await Promise.all([
          shell.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
              top: parseFloat(style.paddingTop),
              bottom: parseFloat(style.paddingBottom),
              borderRadius: parseFloat(style.borderTopLeftRadius),
            };
          }),
          shell.boundingBox(),
          runtimeTrigger.boundingBox(),
          shell.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth)),
          separator.boundingBox(),
          shell.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
              left: parseFloat(style.paddingLeft),
              right: parseFloat(style.paddingRight),
              border: parseFloat(style.borderLeftWidth),
            };
          }),
          Promise.all([
            firstRow.boundingBox(),
            panel.locator('[cmdk-item]').nth(2).boundingBox(),
          ]),
          firstRow.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
              block: parseFloat(style.paddingTop),
              gap: parseFloat(style.columnGap),
            };
          }),
          firstRow.evaluate((el) => {
            const shellRect = el
              .closest('[data-slot="dropdown-menu-content"]')!
              .getBoundingClientRect();
            const rowRect = el.getBoundingClientRect();
            return rowRect.left - shellRect.left;
          }),
        ]);
      if (!shellBox || !triggerBox || !separatorBox || !rowBoxes[0] || !rowBoxes[1]) {
        return false;
      }
      const innerWidth =
        shellBox.width - shellPads.left - shellPads.right - shellPads.border * 2;
      return padding.top >= 3.5
        && padding.top <= 4.5
        && padding.bottom === padding.top
        && padding.borderRadius >= 7
        && Math.abs(shellBox.height - 143) <= 1
        && Math.abs(shellBox.y - 618) <= 1
        && Math.abs(triggerBox.y - (shellBox.y + shellBox.height)) <= 1
        && borderWidth >= 0.5
        && borderWidth <= 1.5
        && separatorBox.width >= innerWidth - 2
        && separatorBox.width <= shellBox.width
        && Math.abs(separatorBox.x - (shellBox.x + 1)) <= 0.5
        && Math.abs(separatorBox.width - (shellBox.width - 2)) <= 0.5
        && Math.abs(rowBoxes[1].y - rowBoxes[0].y - 28) <= 1
        && rowPadding.block === 4
        && rowPadding.gap === 6
        && rowInset >= 4
        && rowInset <= 6.5;
    }).toBe(true);
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
  const rowBox = await row.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(Math.abs(rowBox!.x - 51)).toBeLessThanOrEqual(0.5);
  const selectedWeight = await row
    .locator('[data-sidebar-grid="label"]')
    .evaluate((el) => Number.parseInt(getComputedStyle(el).fontWeight, 10));
  expect(selectedWeight).toBe(500);
  await row.hover();
  await expect.poll(() => row.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(el).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const alpha = ctx.getImageData(0, 0, 1, 1).data[3];
    const background = getComputedStyle(el).backgroundColor;
    const probe = document.createElement("div");
    probe.style.background = "var(--surface-selected)";
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return alpha === 255
      && background === expected
      && getComputedStyle(el).backgroundImage === "none";
  })).toBe(true);
});

test("project sessions share the coordinator grid without clipping", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enableAgent(page, "codex-acp");
  await injectSession(page, {
    sessionId: "pr56-grid-alignment",
    agentId: "codex-acp",
    cwd: "/tmp/pr56-grid-alignment",
  });
  const navigation = page.getByRole("navigation");
  const localHeading = page.getByTestId("sidebar-local-runtime-row");
  const localHeadingMetrics = await localHeading.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      y: rect.y,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      color: style.color,
    };
  });
  expect(Math.abs(localHeadingMetrics.y - 129)).toBeLessThanOrEqual(0.5);
  expect(localHeadingMetrics.fontSize).toBe("12px");
  expect(localHeadingMetrics.fontWeight).toBe("500");
  expect(localHeadingMetrics.color).toBe(await readColorToken(page, "--fg-muted"));
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
    Number.parseFloat(
      getComputedStyle(element).getPropertyValue("--sidebar-grid-nest-step"),
    ),
  );
  expect(Math.abs(coordinatorGlyph!.x - projectGlyph!.x - nestStep)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(sessionGlyph!.x - projectGlyph!.x - nestStep)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(sessionGlyph!.x - coordinatorGlyph!.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(projectGlyph!.x - 43)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(coordinatorGlyph!.x - 59)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(sessionGlyph!.x - 59)).toBeLessThanOrEqual(0.5);

  const coordinatorBox = await coordinator.boundingBox();
  expect(coordinatorBox).not.toBeNull();
  expect(Math.abs(coordinatorBox!.x - 51)).toBeLessThanOrEqual(0.5);
  await coordinator.hover();
  await expect.poll(() => coordinator.evaluate((el) => {
    const style = getComputedStyle(el);
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = style.backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return {
      color: Array.from(context.getImageData(0, 0, 1, 1).data),
      image: style.backgroundImage,
    };
  })).toEqual({ color: [26, 26, 26, 20], image: "none" });
  await expect.poll(async () => {
    const [labelMetrics, trailingBox, columnGap] = await Promise.all([
      sessionRow.locator('[data-sidebar-grid="label"]').evaluate((labelCell) => {
        const cellRect = labelCell.getBoundingClientRect();
        const text = labelCell.querySelector(".truncate") ?? labelCell;
        return {
          x: cellRect.x,
          width: cellRect.width,
          right: cellRect.right,
          ellipsized: text.scrollWidth > text.clientWidth,
        };
      }),
      sessionRow.locator('[data-sidebar-grid="trailing"]').boundingBox(),
      sessionRow.evaluate((row) => Number.parseFloat(getComputedStyle(row).columnGap)),
    ]);
    return !!trailingBox
      && Math.abs(trailingBox.x - labelMetrics.right - columnGap) <= 1
      && Math.abs(labelMetrics.x - 83) <= 0.5
      && Math.abs(labelMetrics.width - 122) <= 0.5
      && Math.abs(labelMetrics.right - 205) <= 0.5
      && !labelMetrics.ellipsized;
  }).toBe(true);
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
    let box: NonNullable<Awaited<ReturnType<typeof shell.boundingBox>>> | null = null;
    await expect.poll(async () => {
      box = await shell.boundingBox();
      return !!box && box.width > 0 && box.height > 0;
    }).toBe(true);
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
    const suffix = String(index + 1).padStart(2, "0");
    const id = `picker-overflow-${suffix}`;
    const directory = join(home, id);
    return {
      project_id: id,
      name: `Picker ${suffix}`,
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

  let unfilteredHeight = Infinity;
  await expect.poll(async () => {
    const initial = await popover.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const list = element.querySelector('[data-slot="command-list"]') as HTMLElement;
      const input = element.querySelector('[data-slot="command-input-wrapper"]');
      return {
        panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        inside:
          rect.left >= 0
          && rect.top >= 0
          && rect.right <= innerWidth
          && rect.bottom <= innerHeight,
        searchVisible: !!input && input.getBoundingClientRect().height > 0,
        listScrollHeight: list.scrollHeight,
        listClientHeight: list.clientHeight,
        listOverflowY: getComputedStyle(list).overflowY,
      };
    });
    unfilteredHeight = initial.panel.height;
    return initial.inside
      && initial.searchVisible
      && initial.listScrollHeight > initial.listClientHeight
      && ["auto", "scroll"].includes(initial.listOverflowY);
  }).toBe(true);
  await expect.poll(async () => {
    const [triggerBox, popoverBox] = await Promise.all([
      page.locator('[data-composer-footer-control="project"]').boundingBox(),
      popover.boundingBox(),
    ]);
    if (!triggerBox || !popoverBox) return false;
    const gap = triggerBox.y - (popoverBox.y + popoverBox.height);
    return Math.abs(gap) <= 0.5;
  }).toBe(true);
  const projectRows = list
    .locator('[cmdk-item]:not([aria-disabled="true"])')
    .filter({ hasText: /^Picker \d{2}$/ });
  await expect.poll(() =>
    measurePickerRow(projectRows.nth(0), projectRows.nth(1)),
  ).toMatchObject({
    inlinePadding: 8,
    blockPadding: 6,
    height: 28,
    pitch: 28,
    iconX: 8,
    iconWidth: 16,
    textX: 32,
  });

  await search.fill("Picker 01");
  const visibleResults = list
    .locator('[cmdk-item]:not([aria-disabled="true"])')
    .filter({ visible: true });
  await expect(visibleResults).toHaveCount(2);
  const firstResult = visibleResults.first();
  await expect(firstResult).toContainText("Picker 01");
  await expect(firstResult).toHaveAttribute("aria-selected", "true");
  await expect(firstResult).toHaveAttribute("data-selected", "true");
  await expect.poll(() => firstResult.evaluate((el) => {
    const background = getComputedStyle(el).backgroundColor;
    const probe = document.createElement("div");
    probe.style.background = "var(--control-bg-hover)";
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return background === expected;
  })).toBe(true);
  await expect.poll(async () => {
    const filteredPanel = await popover.boundingBox();
    return !!filteredPanel
      && filteredPanel.height < unfilteredHeight
      && Math.abs(filteredPanel.height - 138) <= 0.5;
  }).toBe(true);
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
  const mutedColor = await readColorToken(page, "--fg-muted");
  await expect.poll(async () =>
    footerTriggerMatchesLayout(await measureFooterTrigger(workspaceTrigger), mutedColor),
  ).toBe(true);
  await workspaceTrigger.click();

  const panel = page.getByTestId("composer-workspace-picker-panel");
  const popover = panel.locator("xpath=ancestor::*[@data-slot='popover-content'][1]");
  const search = panel.locator('input[cmdk-input]');
  const list = panel.locator('[data-slot="command-list"]');
  await expect(popover).toBeVisible();
  await expect(search).toBeVisible();

  await expect.poll(async () => {
    const initial = await popover.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const list = element.querySelector('[data-slot="command-list"]') as HTMLElement;
      const input = element.querySelector('[data-slot="command-input-wrapper"]');
      return {
        panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        inside: rect.left >= 0 && rect.top >= 0
          && rect.right <= innerWidth && rect.bottom <= innerHeight,
        searchVisible: !!input && input.getBoundingClientRect().height > 0,
        listScrollHeight: list.scrollHeight,
        listClientHeight: list.clientHeight,
        listOverflowY: getComputedStyle(list).overflowY,
      };
    });
    return initial.inside
      && initial.searchVisible
      && initial.listScrollHeight > initial.listClientHeight
      && ["auto", "scroll"].includes(initial.listOverflowY)
      && Math.abs(initial.panel.height - 334) <= 0.5;
  }).toBe(true);
  await expect.poll(async () => {
    const [triggerBox, popoverBox] = await Promise.all([
      workspaceTrigger.boundingBox(),
      popover.boundingBox(),
    ]);
    if (!triggerBox || !popoverBox) return false;
    const gap = triggerBox.y - (popoverBox.y + popoverBox.height);
    return Math.abs(gap) <= 0.5;
  }).toBe(true);
  const workspaceRows = list
    .locator('[cmdk-item]:not([aria-disabled="true"])')
    .filter({ hasText: /Workspace Overflow/ });
  await expect.poll(() =>
    measurePickerRow(workspaceRows.nth(0), workspaceRows.nth(1)),
  ).toMatchObject({
    inlinePadding: 8,
    blockPadding: 6,
    height: 28,
    pitch: 28,
    iconX: 8,
    iconWidth: 16,
    // Main is 30px; head remains at 32px, a 2px workspace text-offset gap.
    textX: 32,
  });

  await search.fill("Unique Workspace Signal");
  const shortResults = list.locator('[cmdk-item]:not([aria-disabled="true"])');
  await expect.poll(async () => {
    const count = await shortResults.count();
    return count >= 1 && count <= 2;
  }).toBe(true);
  const matchingWorkspaces = list
    .locator('[cmdk-item]:not([aria-disabled="true"])')
    .filter({ hasText: "Unique Workspace Signal" });
  await expect(matchingWorkspaces).toHaveCount(1);
  const selectedWorkspace = list.locator('[cmdk-item][data-selected="true"]').first();
  await expect.poll(() => selectedWorkspace.evaluate((el) => {
    const background = getComputedStyle(el).backgroundColor;
    const probe = document.createElement("div");
    probe.style.background = "var(--control-bg-hover)";
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return background === expected;
  })).toBe(true);
  await expect.poll(async () => (await popover.boundingBox())?.height ?? Infinity)
    .toBeLessThan(160);
});

test("new chat hover wash matches the shared mesh button box", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enableAgent(page, "codex-acp");
  const newChat = page.getByTestId("new-chat-button");
  await newChat.hover();
  const readWash = () => newChat.evaluate((el) => {
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
  // Main's wash ran 15→172 at 28px tall; cells stay on the x22/x46 mesh so the
  // icon keeps a visible gap to the wash's left edge.
  await expect.poll(async () => {
    const wash = await readWash();
    const height = wash.bottom - wash.top;
    return wash.elementBg === "rgba(0, 0, 0, 0)"
      && wash.bg !== "rgba(0, 0, 0, 0)"
      && wash.left >= 14.5
      && wash.left <= 15.5
      && wash.right >= 171.5
      && wash.right <= 172.5
      && height >= 27
      && height <= 29;
  }).toBe(true);
  const iconCell = page.locator('[data-sidebar-row="new-chat"] [data-sidebar-grid="icon"]');
  const labelCell = page.locator('[data-sidebar-row="new-chat"] [data-sidebar-grid="label"]');
  await expect.poll(async () => {
    const [wash, iconBox, labelBox] = await Promise.all([
      readWash(),
      iconCell.boundingBox(),
      labelCell.boundingBox(),
    ]);
    return !!iconBox
      && !!labelBox
      && iconBox.x >= 21.5
      && iconBox.x <= 22.5
      && labelBox.x >= 45.5
      && labelBox.x <= 46.5
      && iconBox.x - wash.left >= 6.5;
  }).toBe(true);
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
      await expect.poll(() => command.evaluate((el) => {
        const cs = getComputedStyle(el);
        const shadowLayers = cs.boxShadow === "none"
          ? []
          : cs.boxShadow.split(/,\s+(?=(?:rgba|rgb)\()/);
        const hasVisibleShadow = shadowLayers.some((layer) => {
          const color = layer.match(/rgba?\(([^)]+)\)/)?.[1];
          const channels = color?.match(/[\d.]+/g)?.map(Number) ?? [];
          const alpha = layer.includes("rgba(") ? channels[3] ?? 1 : 1;
          const lengths = layer.match(/-?[\d.]+px/g)?.map(parseFloat) ?? [];
          const blur = lengths[2] ?? 0;
          const spread = lengths[3] ?? 0;
          return alpha > 0 && (blur !== 0 || spread !== 0);
        });
        return {
          border: parseFloat(cs.borderTopWidth),
          hasVisibleShadow,
        };
      })).toEqual({ border: 0, hasVisibleShadow: false });
      // The dropdown shell is the only framed surface; the nested command keeps
      // no visible border or shadow of its own.
      // Enabled items must not render in disabled ink. cmdk emits
      // `data-disabled="false"` on enabled items, which a bare `[data-disabled]`
      // presence selector would still paint with `--fg-disabled`.
      await expect.poll(async () => {
        const ink = await panel.evaluate((el) => {
          const disabledInk = getComputedStyle(el).getPropertyValue("--fg-disabled").trim()
            || getComputedStyle(document.documentElement)
              .getPropertyValue("--fg-disabled").trim();
          const enabled = Array.from(
            el.querySelectorAll('[cmdk-item][data-disabled="false"], [data-slot="command-item"][data-disabled="false"]'),
          ).slice(0, 8);
          return {
            disabledInk,
            colors: enabled.map((n) => getComputedStyle(n).color),
          };
        });
        const disabledColor = await page.evaluate((ink) => {
          const probe = document.createElement("div");
          probe.style.color = ink;
          document.body.appendChild(probe);
          const rgb = getComputedStyle(probe).color;
          probe.remove();
          return rgb;
        }, ink.disabledInk);
        return ink.colors.every((color) => color !== disabledColor);
      }).toBe(true);
      const shell = page
        .locator('[data-slot="dropdown-menu-content"]')
        .filter({ has: panel });
      // Rows keep main's ~5px inset from the shell edge.
      const firstRow = panel.locator('[cmdk-item]').first();
      const separator = panel.locator('[data-slot="command-separator"]').first();
      const plainRows = panel.locator(".grouped-command-plain-item");
      await expect.poll(async () => {
        const shellBox = await shell.boundingBox();
        if (!shellBox) return false;
        const rowInset = await firstRow.evaluate((el) => {
          const shellRect = el
            .closest('[data-slot="dropdown-menu-content"]')!
            .getBoundingClientRect();
          return el.getBoundingClientRect().left - shellRect.left;
        });
        const [sepBox, shellPads] = await Promise.all([
          separator.boundingBox(),
          shell.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
              left: parseFloat(style.paddingLeft),
              right: parseFloat(style.paddingRight),
              border: parseFloat(style.borderLeftWidth),
            };
          }),
        ]);
        if (!sepBox) return false;
        const innerWidth =
          shellBox.width - shellPads.left - shellPads.right - shellPads.border * 2;
        // The divider spans the shell's content box edge to edge.
        const dividerFits = sepBox.width >= innerWidth - 2;
        const plainCount = await plainRows.count();
        if (plainCount < 1) return false;
        // Account/manage rows render like main's plain DropdownMenuItems: the
        // label sits at the row's padding inset (no icon-track indent) at the
        // default item size (14px), not the grid rows' 12px label-column offset.
        const plainMetrics = await Promise.all(
          Array.from({ length: plainCount }, (_, index) =>
            plainRows.nth(index).evaluate((el) => {
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
            }),
          ),
        );
        return rowInset >= 4
          && rowInset <= 6.5
          && dividerFits
          && plainMetrics.every((metrics) =>
            metrics.labelInset >= 10
              && metrics.labelInset <= 16
              && metrics.fontSize >= 13.5
              && metrics.fontSize <= 14.5);
      }).toBe(true);
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
      await expect.poll(async () => {
        const box = await content.boundingBox();
        return !!box && box.y >= 0 && box.y + box.height <= viewportH;
      }, { message: `${label} bounds` }).toBe(true);
      await expect(content, `${label} opens upward`).toHaveAttribute("data-side", "top");
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
        await expect(trigger).toHaveCSS("outline-style", "none");
        await expect(trigger).toHaveCSS("box-shadow", "none");
        await page.keyboard.press("Escape");
        await expect(content).toBeHidden();
      }

      const runTrigger = page.locator("[data-composer-run-trigger]");
      await runTrigger.click();
      await expect(runTrigger).toHaveCSS("outline-style", "none");
      await expect(runTrigger).toHaveCSS("box-shadow", "none");
      const runMenu = page
        .locator('[data-slot="dropdown-menu-content"]')
        .first();
      await expectInsideWindow(runMenu, "harness/agent menu");

      const subTrigger = runMenu.locator('[data-slot="dropdown-menu-sub-trigger"]').first();
      await subTrigger.hover();
      const subMenu = page.locator('[data-slot="dropdown-menu-sub-content"]').first();
      await expect(subMenu).toBeVisible({ timeout: 10_000 });
      await expect.poll(async () => {
        const [menuBox, subBox] = await Promise.all([
          runMenu.boundingBox(),
          subMenu.boundingBox(),
        ]);
        return !!menuBox
          && !!subBox
          && subBox.y + subBox.height <= viewportH
          && Math.abs(
            menuBox.y + menuBox.height - (subBox.y + subBox.height),
          ) <= 3;
      }).toBe(true);
      await expect.poll(() => subMenu.evaluate((el) => {
        const cs = getComputedStyle(el);
        return /hidden|auto/.test(cs.overflowY) && cs.maxHeight !== "none";
      })).toBe(true);
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
        await expect(chip).toHaveCSS("outline-style", "none");
        await expect(chip).toHaveCSS("box-shadow", "none");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
    }
  } finally {
    await mock.close();
  }
});
