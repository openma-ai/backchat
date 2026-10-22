import { useLayoutEffect, useState } from "react";

/**
 * `--gap-adjacent`: wherever adjacent rounded/highlighted surfaces would
 * touch (menus vs triggers, sidebar parent/child washes, stacked pills).
 * See `docs/gap-adjacent.md`. Not general list/section spacing.
 */
export const GAP_ADJACENT_CSS_VAR = "--gap-adjacent";

/** Keep aligned with `--gap-adjacent` in `styles/index.css`. */
export const GAP_ADJACENT_PX = 6;

function readCssLengthTokenPx(
  root: Element,
  cssVar: string,
): number | null {
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.marginTop = `var(${cssVar})`;
  root.appendChild(probe);
  const parsed = Number.parseFloat(getComputedStyle(probe).marginTop);
  probe.remove();
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return null;
}

export function readGapAdjacentPx(
  element: Element = document.documentElement,
): number {
  return (
    readCssLengthTokenPx(element, GAP_ADJACENT_CSS_VAR) ?? GAP_ADJACENT_PX
  );
}

/** Radix `sideOffset` when a menu/popover sits on a highlighted trigger. */
export function useGapAdjacentPx(): number {
  const [gap, setGap] = useState(GAP_ADJACENT_PX);

  useLayoutEffect(() => {
    setGap(readGapAdjacentPx());
  }, []);

  return gap;
}
