import { expect, test } from "./fixtures";
import {
  enableAgent,
  hostPickerPanel,
  injectEvent,
  injectSession,
  openRuntimeLocationPicker,
} from "./helpers";
import { startOpenmaCatalogMock } from "./openma-catalog-mock-server";

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
        (el) => getComputedStyle(el).backgroundColor,
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
  const mock = await startOpenmaCatalogMock({ cloudEnvironmentCount: 1 });
  try {
    await page.evaluate(async (baseUrl) => {
      await window.backchat.openmaLogin(baseUrl);
    }, mock.baseUrl);
    await enableAgent(page, "codex-acp");
    await page.getByTestId("new-chat-button").click();
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
    expect(shellBox?.height ?? 0).toBeGreaterThanOrEqual(141);
    expect(shellBox?.height ?? 0).toBeLessThanOrEqual(146);
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
    const firstRow = panel.locator('[cmdk-item]').first();
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
