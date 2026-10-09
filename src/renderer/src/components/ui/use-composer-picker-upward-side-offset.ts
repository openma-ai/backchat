import { useLayoutEffect, useState } from "react";

/** Matches `--composer-picker-popover-gap` in `styles/index.css`. */
export const COMPOSER_PICKER_UPWARD_SIDE_OFFSET_CSS_VAR =
  "--composer-picker-popover-gap";

const DEFAULT_COMPOSER_PICKER_UPWARD_SIDE_OFFSET_PX = 2.5;

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

export function readComposerPickerUpwardSideOffsetPx(
  element: Element = document.documentElement,
): number {
  return (
    readCssLengthTokenPx(element, COMPOSER_PICKER_UPWARD_SIDE_OFFSET_CSS_VAR) ??
    DEFAULT_COMPOSER_PICKER_UPWARD_SIDE_OFFSET_PX
  );
}

/** Radix `sideOffset` for composer footer pickers that open upward (`side="top"`). */
export function useComposerPickerUpwardSideOffset(): number {
  const [sideOffset, setSideOffset] = useState(
    DEFAULT_COMPOSER_PICKER_UPWARD_SIDE_OFFSET_PX,
  );

  useLayoutEffect(() => {
    setSideOffset(readComposerPickerUpwardSideOffsetPx());
  }, []);

  return sideOffset;
}
