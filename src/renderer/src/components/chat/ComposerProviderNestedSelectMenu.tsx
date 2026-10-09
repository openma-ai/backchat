import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { CheckIcon } from "@/components/Icons";
import {
  ComposerSelectMenuSearch,
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
import { filterSearchableSelectItems } from "@/lib/searchable-select-filter";

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
  const listId = useId();
  const flatSearch = query.trim().length > 0;
  const providers = useMemo(() => groupSelectMenuEntries(items), [items]);
  const activeProvider = useMemo(
    () => activeProviderForValue(items, activeValue),
    [activeValue, items],
  );
  const activeLabel = useMemo(
    () => items.find((item) => item.value === activeValue)?.label,
    [activeValue, items],
  );
  const filtered = useMemo(
    () => filterSearchableSelectItems(items, query),
    [items, query],
  );

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") event.stopPropagation();
  };

  return (
    <div
      data-testid="composer-select-menu-panel"
      className={composerSelectMenuPanelClassName()}
    >
      <ComposerSelectMenuSearch
        inputRef={inputRef}
        value={query}
        onChange={setQuery}
        onKeyDown={onSearchKeyDown}
        placeholder={searchPlaceholder}
        listId={listId}
      />
      {flatSearch ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Options"
          className="oma-scrollbar min-h-0 flex-1 overflow-y-auto p-1"
        >
          {filtered.length === 0 ? (
            <p
              className="px-3 py-6 text-center text-xs leading-relaxed text-fg-subtle"
              role="status"
            >
              {emptyMessage}
            </p>
          ) : (
            filtered.map((item, index) => (
              <div key={item.value} data-composer-select-index={index}>
                {renderItem(
                  {
                    ...item,
                    hint: item.groupName ?? item.hint,
                  },
                  { highlighted: false },
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        <div id={listId} className="oma-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
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
                  <div
                    data-testid="composer-provider-models-panel"
                    className={composerSelectMenuPanelClassName()}
                  >
                    <div className="oma-scrollbar min-h-0 flex-1 overflow-y-auto p-1">
                      {provider.items.map((item, index) => (
                        <div key={item.value} data-composer-select-index={index}>
                          {renderItem(item, { highlighted: false })}
                        </div>
                      ))}
                    </div>
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })}
        </div>
      )}
    </div>
  );
}
