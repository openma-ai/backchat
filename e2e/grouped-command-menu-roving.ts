import { expect, type Locator, type Page } from "@playwright/test";

function selectedItem(panel: Locator) {
  return panel.locator('[data-slot="command-item"][data-selected="true"]');
}

function commandRoot(panel: Locator) {
  return panel.locator('[data-slot="command"]');
}

function allItems(panel: Locator) {
  return panel.locator('[data-slot="command-item"]');
}

async function itemBackgroundAlpha(item: Locator): Promise<number> {
  return item.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = getComputedStyle(el).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3]!;
  });
}

export async function expectGroupedCommandRowWash(item: Locator) {
  const alpha = await itemBackgroundAlpha(item);
  expect(alpha).toBeGreaterThan(0);
}

export async function expectGroupedCommandRovingActive(panel: Locator) {
  await expect(commandRoot(panel)).toHaveAttribute("data-roving-active", "true");
}

export async function expectGroupedCommandSelectedLabel(
  panel: Locator,
  label: string | RegExp,
) {
  const row = selectedItem(panel);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(label);
}

/**
 * Keyboard parity for searchable and search-less grouped menus: roving moves
 * `data-selected`, paints the hover wash on non-checked rows, Enter commits.
 */
export async function exerciseGroupedCommandRovingKeyboard(
  page: Page,
  panel: Locator,
  options: {
    /** Checked row label on open (e.g. current Local). */
    checkedLabel: string | RegExp;
    /** Row above the checked row in DOM order (ArrowUp from checked). */
    rowAboveChecked: string | RegExp;
    /** Row below the checked row (ArrowDown from checked). */
    rowBelowChecked: string | RegExp;
    /** First selectable row (Home). */
    firstRow: string | RegExp;
    /** Last selectable row (End). */
    lastRow: string | RegExp;
    /** Enter on `rowBelowChecked` should close the menu when true. */
    enterSelectsBelow?: boolean;
  },
) {
  await expect(selectedItem(panel)).toHaveCount(1);
  await expect(selectedItem(panel)).toHaveAttribute("data-checked", "true");
  await expectGroupedCommandSelectedLabel(panel, options.checkedLabel);

  await page.keyboard.press("ArrowUp");
  await expectGroupedCommandRovingActive(panel);
  await expectGroupedCommandSelectedLabel(panel, options.rowAboveChecked);
  await expect(selectedItem(panel)).not.toHaveAttribute("data-checked", "true");
  await expectGroupedCommandRowWash(selectedItem(panel));

  await page.keyboard.press("ArrowDown");
  await expectGroupedCommandSelectedLabel(panel, options.checkedLabel);
  await expect(selectedItem(panel)).toHaveAttribute("data-checked", "true");

  await page.keyboard.press("ArrowDown");
  await expectGroupedCommandRovingActive(panel);
  await expectGroupedCommandSelectedLabel(panel, options.rowBelowChecked);
  await expectGroupedCommandRowWash(selectedItem(panel));

  if (options.enterSelectsBelow) {
    await page.keyboard.press("Enter");
    await expect(panel).toBeHidden({ timeout: 10_000 });
    return;
  }

  await page.keyboard.press("Home");
  await expectGroupedCommandSelectedLabel(panel, options.firstRow);

  await page.keyboard.press("End");
  await expectGroupedCommandSelectedLabel(panel, options.lastRow);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden({ timeout: 10_000 });
}

export async function countGroupedCommandItems(panel: Locator) {
  return allItems(panel).count();
}
