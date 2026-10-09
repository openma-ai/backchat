import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  filterSearchableSelectItems,
  type SearchableSelectFields,
} from "@/lib/searchable-select-filter";

export const COMPOSER_SELECT_MENU_MAX_HEIGHT_PX = 420;
export const COMPOSER_SELECT_MENU_SEARCH_THRESHOLD = 8;

export type ComposerSelectMenuEntry = SearchableSelectFields & {
  value: string;
  active?: boolean;
  disabled?: boolean;
  leading?: ReactNode;
};

export function composerSelectMenuPanelClassName(className?: string) {
  return cn(
    "flex max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] flex-col overflow-hidden",
    className,
  );
}

export function composerSelectMenuShellClassName(className?: string) {
  return cn(
    "w-[var(--composer-menu-width)] overflow-hidden p-0",
    className,
  );
}

function groupEntries(items: readonly ComposerSelectMenuEntry[]) {
  const groups: Array<{ name: string | null; items: ComposerSelectMenuEntry[] }> = [];
  const indexByName = new Map<string | null, number>();
  for (const item of items) {
    const name = item.groupName ?? null;
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
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const showSearch =
    items.length >= searchThreshold || items.some((item) => item.groupName);

  const filtered = useMemo(
    () => filterSearchableSelectItems(items, query),
    [items, query],
  );
  const grouped = useMemo(() => groupEntries(filtered), [filtered]);

  const flatFiltered = useMemo(
    () => grouped.flatMap((group) => group.items),
    [grouped],
  );

  const activeIndex = useMemo(() => {
    const preferred = flatFiltered.findIndex(
      (item) => item.value === activeValue || item.active,
    );
    return preferred >= 0 ? preferred : 0;
  }, [activeValue, flatFiltered]);

  const [highlightIndex, setHighlightIndex] = useState(activeIndex);

  useEffect(() => {
    setHighlightIndex(activeIndex);
  }, [activeIndex, query]);

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    const row =
      listRef.current?.querySelector<HTMLElement>(
        `[data-composer-select-index="${highlightIndex}"]`,
      ) ??
      listRef.current?.querySelector<HTMLElement>('[data-composer-select-active="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, filtered.length]);

  const selectHighlighted = useCallback(() => {
    const item = flatFiltered[highlightIndex];
    if (!item || item.disabled) return;
    onSelect(item.value);
  }, [flatFiltered, highlightIndex, onSelect]);

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((current) =>
        flatFiltered.length === 0 ? 0 : Math.min(current + 1, flatFiltered.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectHighlighted();
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
    }
  };

  let runningIndex = -1;

  return (
    <div className={composerSelectMenuPanelClassName()}>
      {showSearch && (
        <div className="shrink-0 border-b border-border/50 p-1.5">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={searchPlaceholder}
            aria-controls={listId}
            aria-label={searchPlaceholder}
            autoComplete="off"
            className="h-8 w-full rounded-md border border-border/60 bg-transparent px-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
      <div
        id={listId}
        ref={listRef}
        role="listbox"
        aria-label="Options"
        className="oma-scrollbar min-h-0 flex-1 overflow-y-auto p-1"
      >
        {flatFiltered.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-fg-subtle" role="status">
            {emptyMessage}
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.name ?? "__ungrouped"} className="min-w-0">
              {group.name ? (
                <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                  {group.name}
                </div>
              ) : null}
              {group.items.map((item) => {
                runningIndex += 1;
                const index = runningIndex;
                const highlighted = index === highlightIndex;
                const active = item.value === activeValue || item.active;
                if (renderItem) {
                  return (
                    <div
                      key={item.value}
                      data-composer-select-index={index}
                      data-composer-select-active={active ? "true" : undefined}
                      data-highlighted={highlighted ? "true" : undefined}
                    >
                      {renderItem(item, { highlighted })}
                    </div>
                  );
                }
                return (
                  <DropdownMenuItem
                    key={item.value}
                    disabled={item.disabled}
                    data-composer-select-index={index}
                    data-composer-select-active={active ? "true" : undefined}
                    data-highlighted={highlighted ? "true" : undefined}
                    onSelect={() => onSelect(item.value)}
                    className={cn(
                      "flex min-h-10 items-start gap-2 px-2 py-1.5 text-xs",
                      highlighted && "bg-accent text-accent-foreground",
                      active && "text-fg",
                    )}
                  >
                    {item.leading}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.hint ? (
                        <span className="block truncate text-[11px] text-fg-subtle">
                          {item.hint}
                        </span>
                      ) : null}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
