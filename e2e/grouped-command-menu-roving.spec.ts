import { expect, test } from "./fixtures";
import { exerciseGroupedCommandRovingKeyboard } from "./grouped-command-menu-roving";
import {
  enableAgent,
  hostPickerPanel,
  openRuntimeLocationPicker,
} from "./helpers";
import { startOpenmaCatalogMock } from "./openma-catalog-mock-server";

test("composer host picker keyboard roving and Enter", async ({ page, home }) => {
  test.setTimeout(120_000);
  await enableAgent(page, "codex-acp");
  await page.getByTestId("new-chat-button").click();
  await openRuntimeLocationPicker(page);
  const panel = hostPickerPanel(page);
  await exerciseGroupedCommandRovingKeyboard(page, panel, {
    checkedLabel: /Local|本地/,
    rowAboveChecked: /Sign in|登录/,
    rowBelowChecked: /Sign in|登录/,
    firstRow: /Sign in|登录/,
    lastRow: /Local|本地/,
  });
});

test("sidebar host picker keyboard roving and Escape", async ({ page }) => {
  test.setTimeout(120_000);
  await enableAgent(page, "codex-acp");
  await page.getByTestId("sidebar-local-runtime-row").click();
  const panel = page.getByTestId("sidebar-host-picker-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await exerciseGroupedCommandRovingKeyboard(page, panel, {
    checkedLabel: /Local|本地/,
    rowAboveChecked: /Sign in|登录/,
    rowBelowChecked: /Sign in|登录/,
    firstRow: /Sign in|登录/,
    lastRow: /Local|本地/,
  });
});

test("composer host picker Enter selects cloud target after ArrowDown", async ({
  page,
  home,
}) => {
  test.setTimeout(180_000);
  const mock = await startOpenmaCatalogMock({ cloudEnvironmentCount: 1 });
  try {
    await page.evaluate(async (baseUrl) => {
      await window.backchat.openmaLogin(baseUrl);
    }, mock.baseUrl);
    await enableAgent(page, "codex-acp");
    await page.getByTestId("new-chat-button").click();
    await openRuntimeLocationPicker(page);
    const panel = hostPickerPanel(page);
    await expect(panel.getByRole("option", { name: /Cloud project 01/ })).toBeVisible({
      timeout: 15_000,
    });
    await exerciseGroupedCommandRovingKeyboard(page, panel, {
      checkedLabel: /Local|本地/,
      rowAboveChecked: /OpenMA account|OpenMA 账户/,
      rowBelowChecked: /Cloud project 01/,
      firstRow: /OpenMA account|OpenMA 账户/,
      lastRow: /Manage resources|管理资源/,
      enterSelectsBelow: true,
    });
    await expect(
      page.locator('[data-composer-footer-control="runtime"]'),
    ).toContainText(/Cloud project 01/);
  } finally {
    await mock.close();
  }
});
