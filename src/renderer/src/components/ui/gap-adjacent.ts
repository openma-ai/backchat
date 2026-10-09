import { useLayoutEffect, useState } from "react";

/** Tiny separation between adjacent rounded surfaces (menus, sidebar parent/child rows). */
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

/** Radix `sideOffset` for menus/popovers separated from their trigger. */
export function useGapAdjacentPx(): number {
  const [gap, setGap] = useState(GAP_ADJACENT_PX);

  useLayoutEffect(() => {
    setGap(readGapAdjacentPx());
  }, []);

  return gap;
}
