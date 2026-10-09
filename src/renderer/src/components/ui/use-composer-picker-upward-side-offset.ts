import {
  GAP_ADJACENT_CSS_VAR,
  GAP_ADJACENT_PX,
  readGapAdjacentPx,
  useGapAdjacentPx,
} from "@/components/ui/gap-adjacent";

/** @deprecated Use `GAP_ADJACENT_CSS_VAR` */
export const COMPOSER_MENU_SIDE_OFFSET_CSS_VAR = GAP_ADJACENT_CSS_VAR;

/** @deprecated Use `GAP_ADJACENT_CSS_VAR` */
export const COMPOSER_PICKER_UPWARD_SIDE_OFFSET_CSS_VAR = GAP_ADJACENT_CSS_VAR;

/** @deprecated Use `GAP_ADJACENT_PX` */
export const COMPOSER_MENU_SIDE_OFFSET_PX = GAP_ADJACENT_PX;

/** @deprecated Use `readGapAdjacentPx` */
export const readComposerMenuSideOffsetPx = readGapAdjacentPx;

/** @deprecated Use `readGapAdjacentPx` */
export const readComposerPickerUpwardSideOffsetPx = readGapAdjacentPx;

/** @deprecated Use `useGapAdjacentPx` */
export function useComposerPickerUpwardSideOffset(): number {
  return useGapAdjacentPx();
}
