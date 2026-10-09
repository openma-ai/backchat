import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
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

export const GROUPED_COMMAND_LIST_HEIGHT_PX = 288;
export const GROUPED_COMMAND_PANEL_HEIGHT_PX = 336;

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
  listHeightPx = GROUPED_COMMAND_LIST_HEIGHT_PX,
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
  listHeightPx?: number;
}) {
  const [commandValue, setCommandValue] = useState(initialHighlightValue);

  useEffect(() => {
    setCommandValue(initialHighlightValue);
  }, [initialHighlightValue]);

  const listStyle = {
    ["--grouped-command-list-height" as string]: `${listHeightPx}px`,
  } as CSSProperties;

  return (
    <div
      data-testid={testId}
      data-composer-select-menu-mode={menuMode}
      className={panelClassName ?? composerSelectMenuPanelClassName()}
      style={listStyle}
    >
      <Command
        value={commandValue}
        onValueChange={setCommandValue}
        className={cn(
          "grouped-command-picker size-full min-h-0 overflow-hidden rounded-none! border-0 bg-transparent p-0 shadow-none ring-0",
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
            "oma-scrollbar min-h-0 flex-1 overflow-y-auto scroll-py-1 outline-none max-h-none",
            listClassName,
          )}
        >
          <CommandEmpty className="px-3 text-center text-xs leading-relaxed text-fg-subtle">
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
