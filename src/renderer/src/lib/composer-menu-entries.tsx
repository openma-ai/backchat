import type { ReactNode } from "react";
import type { ComposerSelectMenuEntry } from "@/components/composer/searchable-select-menu-adapter";
import {
  GroupedCommandMenuIconSlot,
  GroupedCommandMenuLabelSlot,
} from "@/components/ui/grouped-command-menu-slots";
import type { GroupedCommandMenuGroup } from "@/components/ui/grouped-command-menu";
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
      <GroupedCommandMenuIconSlot>
        {item.leading ?? <span className="size-3.5" aria-hidden="true" />}
      </GroupedCommandMenuIconSlot>
      <GroupedCommandMenuLabelSlot>
        <span className="block truncate">{item.label}</span>
        {item.hint ? (
          <span className="block truncate text-[11px] text-fg-subtle">{item.hint}</span>
        ) : null}
      </GroupedCommandMenuLabelSlot>
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
): GroupedCommandMenuGroup[] {
  const named = groupSelectMenuEntries(items);
  const ungrouped = items.filter((item) => !item.groupName?.trim());

  const groups: GroupedCommandMenuGroup[] = named.map((group) => ({
    heading: group.name,
    items: group.items.map((item) =>
      mapEntryToCommandItem(item, activeValue, onSelect, renderItem),
    ),
  }));

  if (ungrouped.length > 0) {
    groups.push({
      items: ungrouped.map((item) =>
        mapEntryToCommandItem(item, activeValue, onSelect, renderItem),
      ),
    });
  }

  return groups;
}
