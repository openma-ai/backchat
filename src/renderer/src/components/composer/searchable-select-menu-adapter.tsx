import { useMemo, type ReactNode } from "react";
import {
  GROUPED_COMMAND_MENU_DROPDOWN_LIST_HEIGHT_PX,
  GroupedCommandMenu,
  groupedCommandMenuPresets,
} from "@/components/ui/grouped-command-menu";
import { menuEntriesToCommandGroups } from "@/lib/composer-menu-entries";
import { searchableSelectHaystack } from "@/lib/searchable-select-filter";
import type { SearchableSelectFields } from "@/lib/searchable-select-filter";

export const COMPOSER_SELECT_MENU_SEARCH_THRESHOLD = 8;

export type ComposerSelectMenuEntry = SearchableSelectFields & {
  value: string;
  active?: boolean;
  disabled?: boolean;
  leading?: ReactNode;
};

/** Composer feature adapter: flat searchable entries → grouped command menu. */
export function ComposerSearchableSelectMenu({
  items,
  activeValue,
  onSelect,
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
  searchThreshold = COMPOSER_SELECT_MENU_SEARCH_THRESHOLD,
  renderItem,
}: {
  items: readonly ComposerSelectMenuEntry[];
  activeValue?: string;
  onSelect: (value: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
  searchThreshold?: number;
  renderItem?: (item: ComposerSelectMenuEntry, state: { highlighted: boolean }) => ReactNode;
}) {
  const showSearch =
    items.length >= searchThreshold || items.some((item) => item.groupName);
  const activeItem = useMemo(
    () => items.find((item) => item.value === activeValue || item.active),
    [activeValue, items],
  );
  const groups = useMemo(
    () => menuEntriesToCommandGroups(items, { activeValue, onSelect, renderItem }),
    [activeValue, items, onSelect, renderItem],
  );
  const initialHighlightValue = useMemo(() => {
    for (const group of groups) {
      for (const item of group.items) {
        if (item.checked) return item.value;
      }
    }
    return activeItem ? searchableSelectHaystack(activeItem) : "";
  }, [groups, activeItem]);

  return (
    <GroupedCommandMenu
      testId="composer-select-menu-panel"
      groups={groups}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      showSearch={showSearch}
      initialHighlightValue={initialHighlightValue}
      insideDropdownMenu
      listHeightPx={GROUPED_COMMAND_MENU_DROPDOWN_LIST_HEIGHT_PX}
      panelHeightPx={groupedCommandMenuPresets.composerDropdown.panelHeightPx}
    />
  );
}
