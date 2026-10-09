# Composer picker layering

All composer pickers (project, workspace, host/runtime, model) share one UI
primitive. Features only supply data and host chrome (popover vs dropdown).

## `components/ui/` — primitives

| Module | Responsibility |
|--------|----------------|
| `grouped-command-menu.tsx` | Searchable grouped cmdk list: fixed list viewport, overlay scrollbar, roving highlight, checked-row policy, panel presets |
| `grouped-command-menu-slots.tsx` | Icon / label grid columns (sidebar mesh) |
| `use-grouped-command-roving-highlight.ts` | Suppress false cmdk `data-selected` wash until keyboard roving |
| `composer-footer-trigger.ts` | Footer chip trigger class; open wash + outline in `index.css` `.app-compact-control` |
| `grouped-command-field.tsx` | Form/settings select: flush trigger + menu chrome, wraps `GroupedCommandMenu` |
| `gap-adjacent.ts` | Documents `--gap-adjacent` (CSS-only twin hover/selected row separation in sidebar) |

Styles: `.grouped-command-menu` in `src/renderer/src/styles/index.css`.

Upward footer menus (`side="top"` on project / workspace popovers and host
dropdown) use Radix `sideOffset` from `useGapAdjacentPx()` / `--gap-adjacent`
(same token as sidebar rules that separate twin hover/selected rounded rows).
Do not use this token for ordinary sidebar list rhythm.

## `components/composer/` — thin adapters

| Module | Responsibility |
|--------|----------------|
| `searchable-select-menu-adapter.tsx` | Flat `ComposerSelectMenuEntry[]` → `GroupedCommandMenu` (model picker, harness menus) |

## `lib/` — data shaping

| Module | Responsibility |
|--------|----------------|
| `composer-menu-entries.tsx` | `menuEntriesToCommandGroups()` for searchable entries |
| `composer-select-menu-layout.ts` | Group-by-provider layout |
| `searchable-select-filter.ts` | Haystack / filter fields |

## `components/chat/` — feature wiring

| Surface | Host | Data |
|---------|------|------|
| Project | `Popover` + `GroupedCommandMenu` | `ComposerProjectControls` builds `groups` inline |
| Workspace | `Popover` + `GroupedCommandMenu` | `WorkspaceChip` builds `groups` + `listHeader` |
| Host (本机) | `DropdownMenu` + `GroupedCommandMenu` | `RuntimeLocationControl` builds `groups` |
| Model | `DropdownMenuSub` + `ComposerSearchableSelectMenu` | Session controls build `items` |
| Coordinator settings | `GroupedCommandField` | `Projects.tsx` passes options + `AgentIcon` leading |

Styles: `.grouped-command-field-*` for attached trigger/menu corners in `index.css`.

Do not reimplement list scrolling, highlight rules, or grid mesh in feature code.
