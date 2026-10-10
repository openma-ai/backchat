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

test("new chat row hover is a single leading wash that stops before trailing actions", async ({
  page,
}) => {
  await enableAgent(page, "codex-acp");
  const row = page.locator('[data-sidebar-row="new-chat"]');
  await row.hover();
  const metrics = await row.evaluate((el) => {
    const rowBox = el.getBoundingClientRect();
    const trailing = el.querySelector('[data-sidebar-grid="trailing"]')!;
    const trailingBox = trailing.getBoundingClientRect();
    const rowBg = getComputedStyle(el).backgroundColor;
    const trailingBg = getComputedStyle(trailing).backgroundColor;
    const wash = getComputedStyle(el, "::before").backgroundColor;
    const washWidth = parseFloat(getComputedStyle(el, "::before").width);
    return { rowBg, trailingBg, wash, washWidth, rowWidth: rowBox.width, trailingLeft: trailingBox.left, rowLeft: rowBox.left };
  });
  expect(metrics.rowBg).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
  expect(metrics.trailingBg).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
  expect(metrics.wash).not.toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
  expect(metrics.washWidth).toBeLessThan(metrics.rowWidth - 40);
  expect(metrics.trailingLeft - metrics.rowLeft).toBeGreaterThan(metrics.washWidth - 4);
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
    await expect(panel.locator('[data-slot="command-separator"]')).toHaveCount(1);
    const commandRoot = panel.locator("[data-slot='command']");
    const padding = await commandRoot.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        top: parseFloat(style.paddingTop),
        bottom: parseFloat(style.paddingBottom),
      };
    });
    expect(padding.top).toBeGreaterThanOrEqual(4.5);
    expect(padding.top).toBeLessThanOrEqual(5.5);
    expect(padding.bottom).toBe(padding.top);
    const manage = panel.getByRole("option", { name: /Manage OpenMA|管理 OpenMA/i });
    const separatorsBeforeManage = await manage.evaluate((el) => {
      let node = el.previousElementSibling;
      let count = 0;
      while (node) {
        if (node.getAttribute("data-slot") === "command-separator") count += 1;
        node = node.previousElementSibling;
      }
      return count;
    });
    expect(separatorsBeforeManage).toBe(0);
    const panelBox = await panel.boundingBox();
    expect(panelBox?.height ?? 0).toBeGreaterThanOrEqual(140);
    expect(panelBox?.height ?? 0).toBeLessThanOrEqual(146);
    const borderWidth = await commandRoot.evaluate((el) =>
      parseFloat(getComputedStyle(el).borderTopWidth),
    );
    expect(borderWidth).toBe(1);
    const separator = panel.locator('[data-slot="command-separator"]').first();
    const separatorBox = await separator.boundingBox();
    const innerWidth = panelBox!.width - padding.top * 2 - borderWidth * 2;
    expect(separatorBox!.width).toBeGreaterThanOrEqual(innerWidth - 2);
    expect(separatorBox!.width).toBeLessThanOrEqual(innerWidth + 2);
    const firstRow = panel.locator('[cmdk-item]').first();
    const rowInset = await firstRow.evaluate((el) => {
      const panelRect = el
        .closest('[data-slot="command"]')!
        .getBoundingClientRect();
      const rowRect = el.getBoundingClientRect();
      return rowRect.left - panelRect.left;
    });
    expect(rowInset).toBeGreaterThanOrEqual(4.5);
    expect(rowInset).toBeLessThanOrEqual(5.5);
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
