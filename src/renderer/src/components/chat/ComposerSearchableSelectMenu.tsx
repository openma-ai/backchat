import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { CheckIcon, ChevronRightIcon } from "@/components/Icons";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  activeProviderForValue,
  groupSelectMenuEntries,
  shouldUseProviderSubmenu,
} from "@/lib/composer-select-menu-layout";
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

export function composerSelectMenuShellClassName({
  wide = false,
  className,
}: {
  wide?: boolean;
  className?: string;
} = {}) {
  return cn(
    wide
      ? "w-[min(520px,calc(var(--composer-menu-width)+220px))]"
      : "w-[var(--composer-menu-width)]",
    "overflow-hidden p-0",
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

type MenuPane = "providers" | "models";

function SelectMenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
      {children}
    </div>
  );
}

function ProviderMark({ name }: { name: string }) {
  const initials = name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-[var(--control-bg-hover)] text-[9px] font-semibold leading-none text-fg-subtle"
      aria-hidden="true"
    >
      {initials || "?"}
    </span>
  );
}

export function ComposerSearchableSelectMenu({
  items,
  activeValue,
  onSelect,
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
  searchThreshold = COMPOSER_SELECT_MENU_SEARCH_THRESHOLD,
  recentItems,
  recentSectionLabel = "Recent",
  providerUnavailableLabel = "Unavailable",
  renderItem,
}: {
  items: readonly ComposerSelectMenuEntry[];
  activeValue?: string;
  onSelect: (value: string) => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
  searchThreshold?: number;
  recentItems?: readonly ComposerSelectMenuEntry[];
  recentSectionLabel?: string;
  providerUnavailableLabel?: string;
  renderItem?: (item: ComposerSelectMenuEntry, state: { highlighted: boolean }) => ReactNode;
}) {
  const listId = useId();
  const modelListId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const showSearch =
    items.length >= searchThreshold || items.some((item) => item.groupName);
  const twoLevel = shouldUseProviderSubmenu(items, searchThreshold);
  const flatSearch = query.trim().length > 0;
  const useProviderMenu = twoLevel && !flatSearch;

  const filtered = useMemo(
    () => filterSearchableSelectItems(items, query),
    [items, query],
  );
  const grouped = useMemo(() => groupEntries(filtered), [filtered]);
  const providers = useMemo(() => groupSelectMenuEntries(items), [items]);
  const activeProvider = useMemo(
    () => activeProviderForValue(items, activeValue),
    [activeValue, items],
  );

  const flatFiltered = useMemo(
    () => grouped.flatMap((group) => group.items),
    [grouped],
  );

  const [pane, setPane] = useState<MenuPane>("providers");
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [providerHighlight, setProviderHighlight] = useState(0);
  const [modelHighlight, setModelHighlight] = useState(0);

  const openProviderModels = useMemo(() => {
    if (!openProvider) return [];
    return items.filter((item) => item.groupName === openProvider);
  }, [items, openProvider]);

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

  useEffect(() => {
    if (!useProviderMenu) return;
    if (activeProvider) {
      const providerIndex = providers.findIndex((group) => group.name === activeProvider);
      if (providerIndex >= 0) setProviderHighlight(providerIndex);
    }
    setOpenProvider((current) => current ?? activeProvider ?? providers[0]?.name ?? null);
  }, [useProviderMenu, activeProvider, providers]);

  useEffect(() => {
    if (!openProvider) return;
    const modelIndex = items
      .filter((item) => item.groupName === openProvider)
      .findIndex((item) => item.value === activeValue);
    setModelHighlight(modelIndex >= 0 ? modelIndex : 0);
  }, [openProvider, activeValue, items]);

  const scrollHighlighted = useCallback(() => {
    if (useProviderMenu) {
      if (pane === "providers") {
        listRef.current
          ?.querySelector<HTMLElement>(`[data-composer-provider-index="${providerHighlight}"]`)
          ?.scrollIntoView({ block: "nearest" });
      } else {
        modelListRef.current
          ?.querySelector<HTMLElement>(`[data-composer-select-index="${modelHighlight}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    listRef.current
      ?.querySelector<HTMLElement>(`[data-composer-select-index="${flatHighlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [flatHighlight, modelHighlight, pane, providerHighlight, useProviderMenu]);

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (useProviderMenu && pane === "providers") return;
    scrollHighlighted();
  }, [flatHighlight, flatFiltered.length, modelHighlight, pane, scrollHighlighted, useProviderMenu]);

  const selectFlatHighlighted = useCallback(() => {
    const item = flatFiltered[flatHighlight];
    if (!item || item.disabled) return;
    onSelect(item.value);
  }, [flatFiltered, flatHighlight, onSelect]);

  const openProviderPane = useCallback(
    (providerName: string) => {
      setOpenProvider(providerName);
      setPane("models");
      const models = items.filter((item) => item.groupName === providerName);
      const activeIndex = models.findIndex((item) => item.value === activeValue);
      setModelHighlight(activeIndex >= 0 ? activeIndex : 0);
      requestAnimationFrame(() => modelListRef.current?.focus());
    },
    [activeValue, items],
  );

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (useProviderMenu && !flatSearch) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setPane("providers");
        setProviderHighlight((current) =>
          providers.length === 0 ? 0 : Math.min(current + 1, providers.length - 1),
        );
        requestAnimationFrame(() => scrollHighlighted());
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPane("providers");
        setProviderHighlight((current) => Math.max(current - 1, 0));
        requestAnimationFrame(() => scrollHighlighted());
        return;
      }
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        const provider = providers[providerHighlight];
        if (provider) openProviderPane(provider.name);
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
      }
      return;
    }

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

  const onProviderListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!useProviderMenu || flatSearch) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPane("providers");
      setProviderHighlight((current) =>
        providers.length === 0 ? 0 : Math.min(current + 1, providers.length - 1),
      );
      requestAnimationFrame(() => scrollHighlighted());
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setPane("providers");
      setProviderHighlight((current) => Math.max(current - 1, 0));
      requestAnimationFrame(() => scrollHighlighted());
      return;
    }
    if (event.key === "ArrowRight" || event.key === "Enter") {
      event.preventDefault();
      const provider = providers[providerHighlight];
      if (provider) openProviderPane(provider.name);
      return;
    }
  };

  const onModelListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!useProviderMenu || flatSearch) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPane("models");
      setModelHighlight((current) =>
        openProviderModels.length === 0
          ? 0
          : Math.min(current + 1, openProviderModels.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setPane("models");
      setModelHighlight((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setPane("providers");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = openProviderModels[modelHighlight];
      if (item && !item.disabled) onSelect(item.value);
      return;
    }
  };

  const renderModelRow = (
    item: ComposerSelectMenuEntry,
    index: number,
    highlighted: boolean,
    hintOverride?: string,
  ) => {
    const active = item.value === activeValue || item.active;
    const hint = hintOverride ?? item.hint;
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
          {hint ? (
            <span className="block truncate text-[11px] text-fg-subtle">{hint}</span>
          ) : null}
        </span>
      </DropdownMenuItem>
    );
  };

  let runningIndex = -1;

  return (
    <div
      data-testid="composer-select-menu-panel"
      className={composerSelectMenuPanelClassName()}
    >
      {showSearch && (
        <div className="shrink-0 border-b border-border/50 p-1.5">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={searchPlaceholder}
            aria-controls={flatSearch ? listId : `${listId} ${modelListId}`}
            aria-label={searchPlaceholder}
            autoComplete="off"
            className="h-8 w-full rounded-md border border-border/60 bg-transparent px-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}

      {useProviderMenu ? (
        <>
          {recentItems && recentItems.length > 0 ? (
            <div className="shrink-0 border-b border-border/50 p-1">
              <SelectMenuSectionLabel>{recentSectionLabel}</SelectMenuSectionLabel>
              {recentItems.map((item, index) =>
                renderModelRow(item, index, false, item.groupName),
              )}
            </div>
          ) : null}
          <div
            className="flex min-h-0 flex-1 divide-x divide-border/50"
            style={{ maxHeight: "min(420px, var(--radix-dropdown-menu-content-available-height))" }}
          >
          <div
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label="Providers"
            tabIndex={-1}
            onKeyDown={onProviderListKeyDown}
            className="oma-scrollbar w-[44%] min-w-[118px] shrink-0 overflow-y-auto p-1"
          >
            {providers.map((provider, index) => {
              const highlighted = pane === "providers" && providerHighlight === index;
              const active = provider.name === activeProvider;
              const open = openProvider === provider.name;
              const unavailable =
                provider.items.length > 0
                && provider.items.every((item) => item.disabled);
              return (
                <DropdownMenuItem
                  key={provider.name}
                  disabled={unavailable}
                  data-composer-provider-row="true"
                  data-composer-provider-index={index}
                  aria-selected={open}
                  className={cn(
                    "flex min-h-10 cursor-default items-center gap-1.5 rounded-md px-2 py-1.5 text-xs",
                    highlighted && "bg-accent text-accent-foreground",
                    open && "bg-[var(--control-bg-hover)]",
                    unavailable && "opacity-50",
                  )}
                  onSelect={(event) => {
                    event.preventDefault();
                    if (unavailable) return;
                    openProviderPane(provider.name);
                  }}
                  onFocus={() => {
                    setProviderHighlight(index);
                    setPane("providers");
                    setOpenProvider(provider.name);
                  }}
                  onMouseEnter={() => {
                    setProviderHighlight(index);
                    setPane("providers");
                    setOpenProvider(provider.name);
                  }}
                >
                  <ProviderMark name={provider.name} />
                  <span className="min-w-0 flex-1 truncate font-medium">{provider.name}</span>
                  {unavailable ? (
                    <span className="shrink-0 text-[10px] text-fg-subtle">
                      {providerUnavailableLabel}
                    </span>
                  ) : (
                    <span className="shrink-0 tabular-nums text-fg-subtle">
                      {provider.items.length}
                    </span>
                  )}
                  {active ? (
                    <CheckIcon className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
                  ) : null}
                  <ChevronRightIcon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                </DropdownMenuItem>
              );
            })}
          </div>

          <div
            id={modelListId}
            ref={modelListRef}
            role="listbox"
            data-testid="composer-model-pane"
            aria-label={openProvider ? `${openProvider} models` : "Models"}
            tabIndex={-1}
            onKeyDown={onModelListKeyDown}
            className="oma-scrollbar min-w-0 flex-1 overflow-y-auto p-1"
          >
            {openProvider ? (
              <>
                <div className="flex items-center gap-1.5 px-2 pb-1 pt-0.5">
                  <ProviderMark name={openProvider} />
                  <span className="min-w-0 truncate text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                    {openProvider}
                  </span>
                </div>
                {openProviderModels.map((item, index) =>
                  renderModelRow(item, index, pane === "models" && modelHighlight === index),
                )}
              </>
            ) : null}
          </div>
        </div>
        </>
      ) : (
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="Options"
          className="oma-scrollbar min-h-0 flex-1 overflow-y-auto p-1"
        >
          {flatFiltered.length === 0 ? (
            <p
              className="px-3 py-6 text-center text-xs leading-relaxed text-fg-subtle"
              role="status"
            >
              {emptyMessage}
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.name ?? "__ungrouped"} className="min-w-0">
                {group.name && !flatSearch ? (
                  <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                    {group.name}
                  </div>
                ) : null}
                {group.items.map((item) => {
                  runningIndex += 1;
                  const index = runningIndex;
                  const highlighted = index === flatHighlight;
                  const hint =
                    flatSearch && item.groupName
                      ? item.groupName
                      : item.hint;
                  return renderModelRow(
                    { ...item, hint },
                    index,
                    highlighted,
                    hint,
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
