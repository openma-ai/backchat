import {
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { composerSelectMenuPanelClassName } from "@/components/chat/ComposerSearchableSelectMenu";
import { useGroupedCommandRovingHighlight } from "@/components/chat/useGroupedCommandRovingHighlight";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  menuResetKey,
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
  /** Change when the hosting popover/menu opens to reset keyboard-roving highlight. */
  menuResetKey?: string;
}) {
  const [commandValue, setCommandValue] = useState(initialHighlightValue);
  const { commandRovingProps, onKeyDown: onRovingKeyDown } =
    useGroupedCommandRovingHighlight(menuResetKey ?? initialHighlightValue);

  useEffect(() => {
    setCommandValue(initialHighlightValue);
  }, [initialHighlightValue]);

  const listStyle = {
    ["--grouped-command-list-height" as string]: `${listHeightPx}px`,
  } as CSSProperties;

  const mergeRovingKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLDivElement>,
  ) => {
    onRovingKeyDown(event);
    if (event.key === "Escape") event.stopPropagation();
  };

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
        {...commandRovingProps}
        onKeyDown={mergeRovingKeyDown}
      >
        {showSearch ? (
          <CommandInput
            autoFocus={autoFocus}
            placeholder={searchPlaceholder}
            onKeyDown={mergeRovingKeyDown}
          />
        ) : null}
        <ScrollArea
          className={cn(
            "grouped-command-picker-scroll sidebar-scroll-area w-full min-h-0",
            listClassName,
          )}
        >
          <CommandList className="max-h-none overflow-visible scroll-py-1 p-0 outline-none">
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
        </ScrollArea>
      </Command>
    </div>
  );
}
