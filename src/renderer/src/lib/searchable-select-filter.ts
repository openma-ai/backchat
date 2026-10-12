export interface SearchableSelectFields {
  label: string;
  groupName?: string;
  hint?: string;
  searchText?: string;
}

export function searchableSelectHaystack(item: SearchableSelectFields): string {
  return [item.label, item.groupName, item.hint, item.searchText]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

/** Token-wise includes, then character-order fuzzy match on the collapsed haystack. */
export function fuzzyMatchSearchableSelect(query: string, haystack: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const target = haystack.toLocaleLowerCase();
  const tokens = needle.split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => target.includes(token))) {
    return true;
  }
  const compactNeedle = needle.replace(/\s+/g, "");
  let index = 0;
  for (const char of compactNeedle) {
    const next = target.indexOf(char, index);
    if (next === -1) return false;
    index = next + 1;
  }
  return compactNeedle.length > 0;
}

export function filterSearchableSelectItems<T extends SearchableSelectFields>(
  items: readonly T[],
  query: string,
): T[] {
  const trimmed = query.trim();
  if (!trimmed) return [...items];
  return items.filter((item) =>
    fuzzyMatchSearchableSelect(trimmed, searchableSelectHaystack(item)),
  );
}
