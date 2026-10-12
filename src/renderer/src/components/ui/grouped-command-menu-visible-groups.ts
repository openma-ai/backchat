import type { GroupedCommandMenuGroup } from "./grouped-command-menu";
import { fuzzyMatchSearchableSelect } from "@/lib/searchable-select-filter";

export function filterGroupedCommandMenuGroups(
  groups: readonly GroupedCommandMenuGroup[],
  rawQuery: string,
): GroupedCommandMenuGroup[] {
  const query = rawQuery.trim();
  if (!query) return [...groups];
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const haystack = [
          item.value.split("\0").pop() ?? item.value,
          ...(item.keywords ?? []),
        ].join(" ");
        return fuzzyMatchSearchableSelect(query, haystack);
      }),
    }))
    .filter((group) => group.items.length > 0);
}
