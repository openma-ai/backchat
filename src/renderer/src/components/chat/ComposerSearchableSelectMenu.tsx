import { useMemo, type ReactNode } from "react";
import { ComposerGroupedCommandPicker } from "@/components/chat/ComposerGroupedCommandPicker";
import { menuEntriesToCommandGroups } from "@/components/chat/composer-menu-command-groups";
import { cn } from "@/lib/utils";
import type { SearchableSelectFields } from "@/lib/searchable-select-filter";

export const COMPOSER_SELECT_MENU_MAX_HEIGHT_PX = 420;
export const COMPOSER_SELECT_MENU_LIST_HEIGHT_PX = 360;
export const COMPOSER_SELECT_MENU_SEARCH_THRESHOLD = 8;

export type ComposerSelectMenuEntry = SearchableSelectFields & {
  value: string;
  active?: boolean;
  disabled?: boolean;
  leading?: ReactNode;
};

export function composerSelectMenuPanelClassName(className?: string) {
  return cn(
    "flex h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] flex-col overflow-hidden",
    className,
  );
}

export function composerSelectMenuShellClassName({
  className,
}: {
  className?: string;
} = {}) {
  return cn("w-[var(--composer-menu-width)] overflow-hidden p-0", className);
}

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

  return (
    <ComposerGroupedCommandPicker
      groups={groups}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      showSearch={showSearch}
      initialHighlightValue={activeItem?.value ?? ""}
      insideDropdownMenu
    />
  );
}
