import { defaultFilter } from "cmdk";

import type {
  GroupedCommandMenuGroup,
  GroupedCommandMenuItem,
} from "./grouped-command-menu";

function commandItemSearchValue(item: GroupedCommandMenuItem): string {
  const raw = item.value;
  const nullIndex = raw.indexOf("\0");
  return nullIndex >= 0 ? raw.slice(nullIndex + 1) : raw;
}

export function scoreGroupedCommandMenuItem(
  item: GroupedCommandMenuItem,
  query: string,
): number {
  const trimmed = query.trim();
  if (!trimmed) return 1;
  return defaultFilter(
    commandItemSearchValue(item),
    trimmed,
    item.keywords ?? [],
  );
}

/**
 * cmdk-compatible filter + per-group best-match ordering in React (no DOM sort).
 * Headings stay with their group; empty groups drop out.
 */
export function applyGroupedCommandMenuSearch(
  groups: readonly GroupedCommandMenuGroup[],
  rawQuery: string,
): GroupedCommandMenuGroup[] {
  const query = rawQuery.trim();
  if (!query) return [...groups];

  return groups
    .map((group) => {
      const ranked = group.items
        .map((item, index) => ({
          item,
          score: scoreGroupedCommandMenuItem(item, query),
          index,
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index);
      return {
        ...group,
        items: ranked.map((entry) => entry.item),
      };
    })
    .filter((group) => group.items.length > 0);
}
