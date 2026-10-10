import { writeFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";

export type GroupedCommandGridRow = {
  id: string;
  iconLeft: number;
  textLeft: number;
  iconWidth: number;
};

export type GroupedCommandGridMetrics = {
  popoverHeight: number;
  rows: GroupedCommandGridRow[];
  iconLeftMin: number;
  iconLeftMax: number;
  textLeftMin: number;
  textLeftMax: number;
};

export function assertGroupedCommandGridAligned(grid: GroupedCommandGridMetrics) {
  const iconRows = grid.rows.filter((row) => !row.id.startsWith("heading:"));
  expect(iconRows.length).toBeGreaterThan(0);
  const iconLefts = iconRows.map((row) => row.iconLeft);
  expect(Math.max(...iconLefts) - Math.min(...iconLefts)).toBe(0);
  expect(grid.textLeftMax - grid.textLeftMin).toBe(0);
  const widths = iconRows.map((row) => row.iconWidth).filter((w) => w > 0);
  if (widths.length > 1) {
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
  }
}

export async function measureGroupedCommandMenuGrid(
  panel: Locator,
): Promise<GroupedCommandGridMetrics> {
  return panel.evaluate((rootEl) => {
    const root = (rootEl.closest("[data-slot='popover-content']") ??
      rootEl.closest("[data-slot='dropdown-menu-content']") ??
      rootEl) as HTMLElement;
    const scope = root;
    const popoverLeft = root.getBoundingClientRect().left;
    const rel = (value: number) => Math.round(value - popoverLeft);
    const textContentLeft = (el: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().left;
    };

    const rows: GroupedCommandGridRow[] = [];
    const searchWrap = scope.querySelector(
      '[data-slot="command-input-wrapper"]',
    ) as HTMLElement | null;
    const searchIcon = searchWrap?.querySelector("svg") as SVGElement | null;
    const searchInput = scope.querySelector(
      '[data-slot="command-input"]',
    ) as HTMLElement | null;
    if (searchWrap && searchIcon && searchInput) {
      const trackRect = searchIcon.getBoundingClientRect();
      rows.push({
        id: "search",
        iconLeft: rel(trackRect.left),
        textLeft: rel(searchInput.getBoundingClientRect().left),
        iconWidth: Math.round(trackRect.width),
      });
    }

    for (const heading of Array.from(
      scope.querySelectorAll(
        "[data-grouped-command-group-heading], [cmdk-group-heading]",
      ),
    ) as HTMLElement[]) {
      const headingText = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
      rows.push({
        id: `heading:${headingText.slice(0, 32)}`,
        iconLeft: rel(heading.getBoundingClientRect().left),
        textLeft: rel(textContentLeft(heading)),
        iconWidth: 0,
      });
    }

    for (const item of Array.from(
      scope.querySelectorAll('[data-slot="command-item"]'),
    ) as HTMLElement[]) {
      const iconSlot = item.querySelector(
        '[data-grouped-command-grid="icon"]',
      ) as HTMLElement | null;
      const icon =
        (iconSlot?.querySelector("svg") as SVGElement | null) ??
        (iconSlot?.querySelector('[aria-hidden="true"]') as HTMLElement | null) ??
        (item.querySelector("svg") as SVGElement | null);
      const label =
        (item.querySelector(
          '[data-grouped-command-grid="label"] span',
        ) as HTMLElement | null) ??
        (item.querySelector("span.truncate") as HTMLElement | null) ??
        (item.querySelector(
          '[data-grouped-command-grid="label"] div',
        ) as HTMLElement | null) ??
        (item.querySelector(
          '[data-grouped-command-grid="label"]',
        ) as HTMLElement | null) ??
        (Array.from(item.querySelectorAll("span, div")).find(
          (node) =>
            !node.classList.contains("app-select-selected") &&
            !node.closest('[data-grouped-command-grid="icon"]') &&
            (node.textContent ?? "").trim().length > 0,
        ) as HTMLElement | undefined);
      if (!icon || !label) continue;
      const iconRect = (iconSlot ?? icon).getBoundingClientRect();
      const text = (item.textContent ?? "").replace(/\s+/g, " ").trim();
      rows.push({
        id: text.slice(0, 40),
        iconLeft: rel(iconRect.left),
        textLeft: rel(label.getBoundingClientRect().left),
        iconWidth: Math.round(iconRect.width),
      });
    }

    const iconLefts = rows.map((row) => row.iconLeft);
    const textLefts = rows.map((row) => row.textLeft);
    return {
      popoverHeight: Math.round(root.getBoundingClientRect().height),
      rows,
      iconLeftMin: Math.min(...iconLefts),
      iconLeftMax: Math.max(...iconLefts),
      textLeftMin: Math.min(...textLefts),
      textLeftMax: Math.max(...textLefts),
    };
  });
}

export async function burnGroupedCommandGridLines(
  png: Buffer,
  iconLeft: number,
  textLeft: number,
): Promise<Buffer> {
  const image = sharp(png);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${iconLeft + 0.5}" y1="0" x2="${iconLeft + 0.5}" y2="${height}" stroke="#ef4444" stroke-width="3"/>
      <line x1="${textLeft + 0.5}" y1="0" x2="${textLeft + 0.5}" y2="${height}" stroke="#2563eb" stroke-width="3"/>
    </svg>`,
  );
  return image.composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
}

export async function screenshotGroupedCommandMenuGrid(
  page: Page,
  panel: Locator,
  grid: GroupedCommandGridMetrics,
  path: string,
): Promise<void> {
  const iconRows = grid.rows.filter((row) => !row.id.startsWith("heading:"));
  const iconLeft = Math.min(...iconRows.map((row) => row.iconLeft));
  const textLeft = grid.textLeftMin;
  const shotTarget = await resolveGridScreenshotTarget(panel);
  const png = await shotTarget.screenshot({ animations: "disabled" });
  const burned = await burnGroupedCommandGridLines(png, iconLeft, textLeft);
  await writeFile(path, burned);
}

async function resolveGridScreenshotTarget(panel: Locator): Promise<Locator> {
  const testId = await panel.getAttribute("data-testid");
  if (testId?.endsWith("-panel") || testId?.includes("picker")) {
    const popover = panel.locator(
      "xpath=ancestor::*[@data-slot='popover-content' or @data-slot='dropdown-menu-content'][1]",
    );
    if (await popover.count()) return popover.first();
  }
  return panel;
}

export async function captureGroupedMenuGridEvidence(
  page: Page,
  panel: Locator,
  pngPath: string,
  metricsPath: string,
  extraMetrics: Record<string, unknown> = {},
): Promise<GroupedCommandGridMetrics> {
  const grid = await measureGroupedCommandMenuGrid(panel);
  await screenshotGroupedCommandMenuGrid(page, panel, grid, pngPath);
  await writeFile(
    metricsPath,
    `${JSON.stringify({ grid, ...extraMetrics }, null, 2)}\n`,
    "utf8",
  );
  return grid;
}
