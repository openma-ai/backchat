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
 * Applies cmdk-compatible filter + global best-match ordering in React so cmdk
 * never DOM-sorts (workspace listHeader wrappers and grouped headings crash it).
 */
export function applyGroupedCommandMenuSearch(
  groups: readonly GroupedCommandMenuGroup[],
  rawQuery: string,
): GroupedCommandMenuGroup[] {
  const query = rawQuery.trim();
  if (!query) return [...groups];

  const ranked: { item: GroupedCommandMenuItem; score: number; order: number }[] =
    [];
  let order = 0;
  for (const group of groups) {
    for (const item of group.items) {
      const score = scoreGroupedCommandMenuItem(item, query);
      if (score > 0) ranked.push({ item, score, order: order++ });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.order - b.order);
  if (ranked.length === 0) return [];
  return [{ items: ranked.map((entry) => entry.item) }];
}
