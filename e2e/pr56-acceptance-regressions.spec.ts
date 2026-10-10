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

test("new chat row hover spans the icon column", async ({ page }) => {
  await enableAgent(page, "codex-acp");
  const row = page.locator(".sidebar-host-chrome .sidebar-grid-row").first();
  await row.hover();
  const iconAlpha = await row.locator('[data-sidebar-grid="icon"]').evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(el.closest(".sidebar-grid-row")!).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
  expect(iconAlpha).toBeGreaterThan(0);
  const height = (await row.boundingBox())!.height;
  expect(height).toBeGreaterThanOrEqual(27);
  expect(height).toBeLessThanOrEqual(29);
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
    await expect(panel.locator('[data-slot="command-separator"]')).toHaveCount(2);
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
