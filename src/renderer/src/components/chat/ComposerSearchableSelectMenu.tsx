import type { ReactNode } from "react";
import { ComposerSelectCommandMenu } from "@/components/chat/ComposerSelectCommandMenu";
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
  return (
    <ComposerSelectCommandMenu
      items={items}
      activeValue={activeValue}
      onSelect={onSelect}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      searchThreshold={searchThreshold}
      renderItem={renderItem}
    />
  );
}
