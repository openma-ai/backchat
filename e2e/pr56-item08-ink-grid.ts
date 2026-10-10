import type { Locator } from "@playwright/test";

export type InkGridPair = { iconLeft: number; textLeft: number };

/** Left edge of visible ink in viewport coordinates (for full-window screenshots). */
export async function measureMenuInkGrid(
  panel: Locator,
  options?: { scopeSelector?: string },
): Promise<{
  iconLeft: number;
  textLeft: number;
  origin: "viewport";
  rows: { id: string; iconLeft: number; textLeft: number }[];
}> {
  return panel.evaluate((rootEl, opts) => {
    const scope = (opts?.scopeSelector
      ? rootEl.closest(opts.scopeSelector)
      : null) ??
      (rootEl.closest("[data-testid='composer-select-menu-panel']") ??
        rootEl.closest("[data-testid='composer-project-picker-panel']") ??
        rootEl.closest("[data-testid='composer-workspace-picker-panel']") ??
        rootEl.closest("[data-testid='composer-host-picker-panel']") ??
        rootEl.closest("[data-testid='sidebar-host-picker-panel']") ??
        rootEl.closest("[data-slot='popover-content']") ??
        rootEl.closest("[data-slot='dropdown-menu-content']") ??
        rootEl.closest("[data-slot='dropdown-menu-sub-content']") ??
        rootEl) as HTMLElement;

    const svgInkLeft = (svg: SVGElement) => {
      let min = Number.POSITIVE_INFINITY;
      for (const node of svg.querySelectorAll(
        "path, circle, rect, line, polyline, polygon",
      )) {
        const rect = node.getBoundingClientRect();
        if (rect.width < 0.5 || rect.height < 0.5) continue;
        min = Math.min(min, rect.left);
      }
      if (!Number.isFinite(min)) {
        min = svg.getBoundingClientRect().left;
      }
      return min;
    };

    const textInkLeft = (el: HTMLElement) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let min = Number.POSITIVE_INFINITY;
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent?.trim() ?? "";
        if (!text) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        const rect = range.getBoundingClientRect();
        if (rect.width < 0.5) continue;
        min = Math.min(min, rect.left);
      }
      if (!Number.isFinite(min)) {
        min = el.getBoundingClientRect().left;
      }
      return min;
    };

    const rows: { id: string; iconLeft: number; textLeft: number }[] = [];
    const items = Array.from(
      scope.querySelectorAll(
        '[data-slot="command-item"], [role="menuitem"]',
      ),
    ) as HTMLElement[];

    for (const item of items) {
      const iconSlot = item.querySelector(
        '[data-grouped-command-grid="icon"]',
      ) as HTMLElement | null;
      const svg =
        (iconSlot?.querySelector("svg") as SVGElement | null) ??
        (item.querySelector("svg") as SVGElement | null);
      const label =
        (item.querySelector(
          '[data-grouped-command-grid="label"] span',
        ) as HTMLElement | null) ??
        (item.querySelector("span.truncate") as HTMLElement | null) ??
        (item.querySelector('[data-grouped-command-grid="label"]') as
          | HTMLElement
          | null) ??
        (item.querySelector("span.flex-1") as HTMLElement | null);
      if (!svg || !label) continue;
      const text = (item.textContent ?? "").replace(/\s+/g, " ").trim();
      rows.push({
        id: text.slice(0, 48),
        iconLeft: Math.round(svgInkLeft(svg)),
        textLeft: Math.round(textInkLeft(label)),
      });
    }

    const bodyRows = rows.filter(
      (row) =>
        !row.id.toLowerCase().includes("browse") &&
        !row.id.toLowerCase().includes("no project") &&
        !row.id.includes("账户") &&
        !row.id.toLowerCase().includes("account") &&
        !row.id.toLowerCase().includes("sign in") &&
        !row.id.toLowerCase().includes("manage"),
    );
    const measureFrom = bodyRows.length > 0 ? bodyRows : rows;
    const iconLeft = Math.min(...measureFrom.map((row) => row.iconLeft));
    const textLeft = Math.min(...measureFrom.map((row) => row.textLeft));
    return {
      iconLeft,
      textLeft,
      origin: "viewport" as const,
      rows,
    };
  }, options ?? {});
}

export async function sampleRowBackgrounds(
  panel: Locator,
): Promise<{
  selected: string | null;
  neighbor: string | null;
  selectedCheckmarkOpacity: number | null;
}> {
  return panel.evaluate(() => {
    const composited = (el: Element) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const layers: string[] = [];
      let node: Element | null = el;
      while (node) {
        layers.push(getComputedStyle(node).backgroundColor);
        node = node.parentElement;
      }
      ctx.clearRect(0, 0, 1, 1);
      for (const color of layers.reverse()) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
      }
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    };

    const selected =
      (document.querySelector(
        '[data-slot="command-item"][data-selected="true"], [role="menuitem"][data-highlighted]',
      ) as HTMLElement | null) ?? null;
    const items = Array.from(
      document.querySelectorAll(
        '[data-slot="command-item"], [role="menuitem"]',
      ),
    ) as HTMLElement[];
    const neighbor =
      items.find((item) => item !== selected && !item.hasAttribute("disabled")) ??
      null;
    const check = selected?.querySelector(
      ".app-select-selected, svg.app-select-selected",
    ) as HTMLElement | null;
    return {
      selected: selected ? composited(selected) : null,
      neighbor: neighbor ? composited(neighbor) : null,
      selectedCheckmarkOpacity: check
        ? parseFloat(getComputedStyle(check).opacity)
        : null,
    };
  });
}
