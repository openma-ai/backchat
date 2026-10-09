import { useLayoutEffect, useState } from "react";

export const COMPOSER_MENU_SIDE_OFFSET_CSS_VAR = "--composer-menu-side-offset";

export const COMPOSER_PICKER_UPWARD_SIDE_OFFSET_CSS_VAR =
  "--composer-picker-popover-gap";

/** Keep aligned with `--composer-menu-side-offset` in `styles/index.css`. */
export const COMPOSER_MENU_SIDE_OFFSET_PX = 6;

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

export function readComposerMenuSideOffsetPx(
  element: Element = document.documentElement,
): number {
  return (
    readCssLengthTokenPx(element, COMPOSER_MENU_SIDE_OFFSET_CSS_VAR) ??
    COMPOSER_MENU_SIDE_OFFSET_PX
  );
}

export function readComposerPickerUpwardSideOffsetPx(
  element: Element = document.documentElement,
): number {
  return (
    readCssLengthTokenPx(element, COMPOSER_PICKER_UPWARD_SIDE_OFFSET_CSS_VAR) ??
    readComposerMenuSideOffsetPx(element)
  );
}

/** Radix `sideOffset` for composer footer pickers that open upward (`side="top"`). */
export function useComposerPickerUpwardSideOffset(): number {
  const [sideOffset, setSideOffset] = useState(COMPOSER_MENU_SIDE_OFFSET_PX);

  useLayoutEffect(() => {
    setSideOffset(readComposerPickerUpwardSideOffsetPx());
  }, []);

  return sideOffset;
}
