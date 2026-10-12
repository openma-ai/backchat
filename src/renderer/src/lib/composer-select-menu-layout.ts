import type { SearchableSelectFields } from "@/lib/searchable-select-filter";

export const COMPOSER_TWO_LEVEL_MIN_PROVIDERS = 2;
export const COMPOSER_TWO_LEVEL_MIN_ITEMS = 8;

export function groupSelectMenuEntries<T extends SearchableSelectFields>(
  items: readonly T[],
): Array<{ name: string; items: T[] }> {
  const groups: Array<{ name: string; items: T[] }> = [];
  const indexByName = new Map<string, number>();
  for (const item of items) {
    const name = item.groupName?.trim();
    if (!name) continue;
    const existing = indexByName.get(name);
    if (existing === undefined) {
      indexByName.set(name, groups.length);
      groups.push({ name, items: [item] });
      continue;
    }
    groups[existing].items.push(item);
  }
  return groups;
}

export function shouldUseProviderSubmenu(
  items: readonly SearchableSelectFields[],
  threshold = COMPOSER_TWO_LEVEL_MIN_ITEMS,
): boolean {
  const providers = groupSelectMenuEntries(items);
  return providers.length >= COMPOSER_TWO_LEVEL_MIN_PROVIDERS && items.length >= threshold;
}

export function activeProviderForValue<T extends SearchableSelectFields & { value: string }>(
  items: readonly T[],
  activeValue?: string,
): string | undefined {
  if (!activeValue) return undefined;
  return items.find((item) => item.value === activeValue)?.groupName?.trim() || undefined;
}
