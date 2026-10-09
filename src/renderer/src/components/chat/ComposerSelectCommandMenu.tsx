import { Command as CommandPrimitive } from "cmdk";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  COMPOSER_SELECT_MENU_LIST_HEIGHT_PX,
  COMPOSER_SELECT_MENU_SEARCH_THRESHOLD,
  composerSelectMenuPanelClassName,
  type ComposerSelectMenuEntry,
} from "@/components/chat/ComposerSearchableSelectMenu";
import { Command, CommandEmpty, CommandList } from "@/components/ui/command";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  filterSearchableSelectItems,
} from "@/lib/searchable-select-filter";
import { cn } from "@/lib/utils";

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

export function composerSelectMenuListStyle(): React.CSSProperties {
  return {
    height: COMPOSER_SELECT_MENU_LIST_HEIGHT_PX,
    minHeight: COMPOSER_SELECT_MENU_LIST_HEIGHT_PX,
    maxHeight: COMPOSER_SELECT_MENU_LIST_HEIGHT_PX,
  };
}

export function ComposerSelectCommandMenu({
  items,
  activeValue,
  onSelect,
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
  searchThreshold = COMPOSER_SELECT_MENU_SEARCH_THRESHOLD,
  showSearch = true,
  showGroupHeadings = true,
  listOnly = false,
  query: controlledQuery,
  onQueryChange,
  renderItem,
}: {
  items: readonly ComposerSelectMenuEntry[];
  activeValue?: string;
  onSelect: (value: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
  searchThreshold?: number;
  showSearch?: boolean;
  showGroupHeadings?: boolean;
  listOnly?: boolean;
  query?: string;
  onQueryChange?: (query: string) => void;
  renderItem?: (item: ComposerSelectMenuEntry, state: { highlighted: boolean }) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [uncontrolledQuery, setUncontrolledQuery] = useState("");
  const query = controlledQuery ?? uncontrolledQuery;
  const setQuery = onQueryChange ?? setUncontrolledQuery;
  const searching = query.trim().length > 0;
  const searchVisible =
    showSearch && (items.length >= searchThreshold || items.some((item) => item.groupName));

  const filtered = useMemo(
    () => filterSearchableSelectItems(items, query),
    [items, query],
  );
  const grouped = useMemo(() => groupEntries(filtered), [filtered]);
  const flatFiltered = useMemo(
    () => grouped.flatMap((group) => group.items),
    [grouped],
  );

  const activeFlatIndex = useMemo(() => {
    const preferred = flatFiltered.findIndex(
      (item) => item.value === activeValue || item.active,
    );
    return preferred >= 0 ? preferred : 0;
  }, [activeValue, flatFiltered]);

  const [flatHighlight, setFlatHighlight] = useState(activeFlatIndex);

  useEffect(() => {
    setFlatHighlight(activeFlatIndex);
  }, [activeFlatIndex, query]);

  const scrollHighlighted = useCallback(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-composer-select-index="${flatHighlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [flatHighlight]);

  useLayoutEffect(() => {
    scrollHighlighted();
  }, [flatHighlight, flatFiltered.length, scrollHighlighted]);

  const selectFlatHighlighted = useCallback(() => {
    const item = flatFiltered[flatHighlight];
    if (!item || item.disabled) return;
    onSelect(item.value);
  }, [flatFiltered, flatHighlight, onSelect]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFlatHighlight((current) =>
        flatFiltered.length === 0 ? 0 : Math.min(current + 1, flatFiltered.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFlatHighlight((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectFlatHighlighted();
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
    }
  };

  let runningIndex = -1;

  const commandBody = (
    <Command
      shouldFilter={false}
      label={searchPlaceholder}
      className="flex h-full min-h-0 flex-col rounded-none! border-0 bg-transparent p-0 shadow-none ring-0"
    >
      {searchVisible && (
        <div
          className="shrink-0 border-b border-border/50 p-1.5"
          cmdk-input-wrapper=""
        >
          <CommandPrimitive.Input
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            autoComplete="off"
            onKeyDown={onSearchKeyDown}
            className="h-8 w-full rounded-md border border-border/60 bg-transparent px-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
      <CommandList
        ref={listRef}
        className="oma-scrollbar overflow-y-auto p-1 outline-none max-h-none"
        style={composerSelectMenuListStyle()}
      >
        {flatFiltered.length === 0 ? (
          <CommandEmpty className="px-3 py-6 text-center text-xs leading-relaxed text-fg-subtle">
            {emptyMessage}
          </CommandEmpty>
        ) : (
          grouped.map((group) => {
            const heading =
              showGroupHeadings && group.name && !searching ? group.name : undefined;
            return (
              <div key={group.name ?? "__ungrouped"} className="min-w-0">
                {heading ? (
                  <div
                    className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle"
                    cmdk-group-heading=""
                  >
                    {heading}
                  </div>
                ) : null}
                {group.items.map((item) => {
                  runningIndex += 1;
                  const index = runningIndex;
                  const highlighted = index === flatHighlight;
                  const active = item.value === activeValue || item.active;
                  const hint =
                    searching && item.groupName ? item.groupName : item.hint;
                  const row = { ...item, hint };
                  if (renderItem) {
                    return (
                      <div
                        key={item.value}
                        data-composer-select-index={index}
                        data-composer-select-active={active ? "true" : undefined}
                        data-highlighted={highlighted ? "true" : undefined}
                      >
                        {renderItem(row, { highlighted })}
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
                        {hint ? (
                          <span className="block truncate text-[11px] text-fg-subtle">
                            {hint}
                          </span>
                        ) : null}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </div>
            );
          })
        )}
      </CommandList>
    </Command>
  );

  if (listOnly) {
    return (
      <div data-testid="composer-provider-models-panel" className="min-h-0">
        {commandBody}
      </div>
    );
  }

  return (
    <div
      data-testid="composer-select-menu-panel"
      data-composer-select-menu-mode="command"
      className={composerSelectMenuPanelClassName()}
    >
      {commandBody}
    </div>
  );
}
