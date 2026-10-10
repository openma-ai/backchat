# `--gap-adjacent`

One spacing token (`6px` in `:root`) for **adjacent rounded or highlighted
surfaces that would otherwise read as one block**.

Use it (with judgment) for:

- Radix `sideOffset` on menus/popovers opened from chips, triggers, or rows
- Sidebar parent/child rows when both show hover or selected wash (see
  `.sidebar-navigation` rules in `index.css`)
- Stacked composer footer / toolbar chips while a neighbor is hovered or open
- Slash-command sections and similar stacked rounded panels

Do **not** use it for ordinary list rhythm (`space-y-0.5` / `1px`), section
gutters, or attached selects (`GroupedCommandField` stays flush).

**TS:** `readGapAdjacentPx()`, `useGapAdjacentPx()`, `GAP_ADJACENT_PX` from
`components/ui/gap-adjacent.ts`.

**Aliases:** `--composer-menu-side-offset`, `--composer-picker-popover-gap` →
`var(--gap-adjacent)`.
