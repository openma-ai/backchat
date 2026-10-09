import type { ReactNode } from "react";
import type { ComposerGroupedCommandPickerGroup } from "@/components/chat/ComposerGroupedCommandPicker";
import type { ComposerSelectMenuEntry } from "@/components/chat/ComposerSearchableSelectMenu";
import { groupSelectMenuEntries } from "@/lib/composer-select-menu-layout";
import { searchableSelectHaystack } from "@/lib/searchable-select-filter";

function mapEntryToCommandItem(
  item: ComposerSelectMenuEntry,
  activeValue?: string,
  onSelect?: (value: string) => void,
  renderItem?: (
    item: ComposerSelectMenuEntry,
    state: { highlighted: boolean },
  ) => ReactNode,
) {
  const checked = item.value === activeValue || item.active;
  const keywords = [
    item.label,
    item.groupName,
    item.searchText,
    item.hint,
    item.value,
  ].filter(Boolean) as string[];

  const defaultRow = (
    <>
      {item.leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {item.hint ? (
          <span className="block truncate text-[11px] text-fg-subtle">{item.hint}</span>
        ) : null}
      </span>
    </>
  );

  return {
    id: item.value,
    value: searchableSelectHaystack(item),
    keywords,
    checked,
    disabled: item.disabled,
    title: item.label,
    onSelect: () => onSelect?.(item.value),
    children: renderItem ? renderItem(item, { highlighted: false }) : defaultRow,
  };
}

export function menuEntriesToCommandGroups(
  items: readonly ComposerSelectMenuEntry[],
  {
    activeValue,
    onSelect,
    renderItem,
  }: {
    activeValue?: string;
    onSelect: (value: string) => void;
    renderItem?: (
      item: ComposerSelectMenuEntry,
      state: { highlighted: boolean },
    ) => ReactNode;
  },
): ComposerGroupedCommandPickerGroup[] {
  const named = groupSelectMenuEntries(items);
  const ungrouped = items.filter((item) => !item.groupName?.trim());

  const groups: ComposerGroupedCommandPickerGroup[] = named.map((group) => ({
    heading: group.name,
    items: group.items.map((item) =>
      mapEntryToCommandItem(item, activeValue, onSelect, renderItem),
    ),
  }));

  if (ungrouped.length > 0) {
    groups.push({
      heading: groups.length > 0 ? undefined : undefined,
      items: ungrouped.map((item) =>
        mapEntryToCommandItem(item, activeValue, onSelect, renderItem),
      ),
    });
  }

  return groups;
}
