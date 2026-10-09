import { useEffect, useState, type ReactNode } from "react";
import { composerSelectMenuPanelClassName } from "@/components/chat/ComposerSearchableSelectMenu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type ComposerGroupedCommandPickerGroup = {
  heading?: string;
  items: Array<{
    id: string;
    value: string;
    keywords?: string[];
    checked?: boolean;
    disabled?: boolean;
    title?: string;
    onSelect: () => void;
    children: ReactNode;
  }>;
};

/** Grouped searchable list — same Command stack as the draft project picker (“选择项目”). */
export function ComposerGroupedCommandPicker({
  groups,
  searchPlaceholder,
  emptyMessage,
  initialHighlightValue = "",
  showSearch = true,
  autoFocus = true,
  listClassName,
  commandClassName,
  panelClassName,
  testId = "composer-select-menu-panel",
  menuMode = "grouped-command",
  insideDropdownMenu = false,
}: {
  groups: readonly ComposerGroupedCommandPickerGroup[];
  searchPlaceholder: string;
  emptyMessage: string;
  initialHighlightValue?: string;
  showSearch?: boolean;
  autoFocus?: boolean;
  listClassName?: string;
  commandClassName?: string;
  panelClassName?: string;
  testId?: string;
  menuMode?: string;
  insideDropdownMenu?: boolean;
}) {
  const [commandValue, setCommandValue] = useState(initialHighlightValue);

  useEffect(() => {
    setCommandValue(initialHighlightValue);
  }, [initialHighlightValue]);

  return (
    <div
      data-testid={testId}
      data-composer-select-menu-mode={menuMode}
      className={panelClassName ?? composerSelectMenuPanelClassName()}
    >
      <Command
        value={commandValue}
        onValueChange={setCommandValue}
        className={cn(
          "size-full overflow-hidden rounded-none! border-0 bg-transparent p-0 shadow-none ring-0",
          commandClassName,
        )}
      >
        {showSearch ? (
          <CommandInput
            autoFocus={autoFocus}
            placeholder={searchPlaceholder}
            onKeyDown={(event) => {
              if (event.key === "Escape") event.stopPropagation();
            }}
          />
        ) : null}
        <CommandList
          className={cn(
            "min-h-0 max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] flex-1",
            listClassName,
          )}
        >
          <CommandEmpty className="px-3 py-6 text-center text-xs leading-relaxed text-fg-subtle">
            {emptyMessage}
          </CommandEmpty>
          {groups.map((group, index) => (
            <CommandGroup
              key={group.heading ?? `__ungrouped-${index}`}
              heading={group.heading}
            >
              {group.items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.value}
                  keywords={item.keywords}
                  disabled={item.disabled}
                  data-checked={item.checked ? true : undefined}
                  title={item.title}
                  onSelect={item.onSelect}
                  onMouseDown={
                    insideDropdownMenu
                      ? (event) => {
                          event.preventDefault();
                        }
                      : undefined
                  }
                  className="text-xs"
                >
                  {item.children}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </div>
  );
}
