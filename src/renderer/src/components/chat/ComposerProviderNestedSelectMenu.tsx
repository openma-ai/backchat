import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon } from "@/components/Icons";
import {
  ComposerSelectCommandMenu,
  composerSelectMenuListStyle,
} from "@/components/chat/ComposerSelectCommandMenu";
import {
  composerSelectMenuPanelClassName,
  composerSelectMenuShellClassName,
  type ComposerSelectMenuEntry,
} from "@/components/chat/ComposerSearchableSelectMenu";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  activeProviderForValue,
  groupSelectMenuEntries,
} from "@/lib/composer-select-menu-layout";

function ProviderBrowseSearch({
  value,
  onChange,
  placeholder,
  listId,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  listId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="shrink-0 border-b border-border/50 p-1.5" cmdk-input-wrapper="">
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
        placeholder={placeholder}
        aria-controls={listId}
        aria-label={placeholder}
        autoComplete="off"
        className="h-8 w-full rounded-md border border-border/60 bg-transparent px-2 text-xs text-fg outline-none placeholder:text-fg-subtle focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

export function ComposerProviderNestedSelectMenu({
  items,
  activeValue,
  onSelect,
  searchPlaceholder,
  emptyMessage,
  providerIcon,
  renderItem,
}: {
  items: readonly ComposerSelectMenuEntry[];
  activeValue?: string;
  onSelect: (value: string) => void;
  searchPlaceholder: string;
  emptyMessage: string;
  providerIcon: ReactNode;
  renderItem: (item: ComposerSelectMenuEntry, state: { highlighted: boolean }) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = "composer-provider-browse";
  const searching = query.trim().length > 0;
  const providers = useMemo(() => groupSelectMenuEntries(items), [items]);
  const activeProvider = useMemo(
    () => activeProviderForValue(items, activeValue),
    [activeValue, items],
  );
  const activeLabel = useMemo(
    () => items.find((item) => item.value === activeValue)?.label,
    [activeValue, items],
  );

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  if (searching) {
    return (
      <ComposerSelectCommandMenu
        items={items}
        activeValue={activeValue}
        onSelect={onSelect}
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage}
        searchThreshold={0}
        query={query}
        onQueryChange={setQuery}
        showGroupHeadings={false}
        renderItem={renderItem}
      />
    );
  }

  return (
    <div
      data-testid="composer-select-menu-panel"
      data-composer-select-menu-mode="provider-browse"
      className={composerSelectMenuPanelClassName()}
    >
      <ProviderBrowseSearch
        inputRef={inputRef}
        value={query}
        onChange={setQuery}
        placeholder={searchPlaceholder}
        listId={listId}
      />
      <div
        id={listId}
        className="oma-scrollbar overflow-y-auto py-1"
        style={composerSelectMenuListStyle()}
      >
        {providers.map((provider) => {
          const isActiveProvider = provider.name === activeProvider;
          const trailing =
            isActiveProvider && activeLabel
              ? activeLabel
              : String(provider.items.length);
          return (
            <DropdownMenuSub key={provider.name}>
              <DropdownMenuSubTrigger
                data-composer-provider-sub="true"
                className="min-h-10 gap-2 px-2 py-1.5 text-xs"
              >
                {providerIcon}
                <span className="min-w-0 truncate">{provider.name}</span>
                <span className="ml-auto flex max-w-[120px] items-center gap-1 truncate text-fg-subtle">
                  {trailing}
                  {isActiveProvider ? (
                    <CheckIcon
                      className="size-3.5 shrink-0 text-fg-muted"
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                sideOffset={6}
                className={composerSelectMenuShellClassName()}
              >
                <ComposerSelectCommandMenu
                  items={provider.items}
                  activeValue={activeValue}
                  onSelect={onSelect}
                  emptyMessage={emptyMessage}
                  showSearch={false}
                  showGroupHeadings={false}
                  listOnly
                  renderItem={renderItem}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </div>
    </div>
  );
}
