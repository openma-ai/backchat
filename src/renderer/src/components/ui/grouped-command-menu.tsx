import {
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useGroupedCommandRovingHighlight } from "@/components/ui/use-grouped-command-roving-highlight";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export const GROUPED_COMMAND_MENU_LIST_HEIGHT_PX = 288;
export const GROUPED_COMMAND_MENU_PANEL_HEIGHT_PX = 336;
export const GROUPED_COMMAND_MENU_DROPDOWN_PANEL_HEIGHT_PX = 420;
export const GROUPED_COMMAND_MENU_DROPDOWN_LIST_HEIGHT_PX = 360;

export type GroupedCommandMenuItem = {
  id: string;
  value: string;
  keywords?: string[];
  checked?: boolean;
  disabled?: boolean;
  title?: string;
  forceMount?: boolean;
  onSelect: () => void;
  children: ReactNode;
};

export type GroupedCommandMenuGroup = {
  heading?: string;
  items: readonly GroupedCommandMenuItem[];
};

export const groupedCommandMenuPresets = {
  footer: {
    panelHeightPx: GROUPED_COMMAND_MENU_PANEL_HEIGHT_PX,
    listHeightPx: GROUPED_COMMAND_MENU_LIST_HEIGHT_PX,
  },
  composerDropdown: {
    panelHeightPx: GROUPED_COMMAND_MENU_DROPDOWN_PANEL_HEIGHT_PX,
    listHeightPx: GROUPED_COMMAND_MENU_DROPDOWN_LIST_HEIGHT_PX,
  },
} as const;

export function groupedCommandMenuPanelClassName({
  maxHeightPx = GROUPED_COMMAND_MENU_DROPDOWN_PANEL_HEIGHT_PX,
  className,
}: {
  maxHeightPx?: number;
  className?: string;
} = {}) {
  return cn(
    "flex flex-col overflow-hidden",
    `h-[min(${maxHeightPx}px,var(--radix-dropdown-menu-content-available-height))]`,
    `min-h-[min(${maxHeightPx}px,var(--radix-dropdown-menu-content-available-height))]`,
    `max-h-[min(${maxHeightPx}px,var(--radix-dropdown-menu-content-available-height))]`,
    className,
  );
}

export function groupedCommandMenuShellClassName(className?: string) {
  return cn("w-[var(--composer-menu-width)] overflow-hidden p-0", className);
}

export function groupedCommandMenuPopoverShellClassName(className?: string) {
  return cn(
    "w-[var(--composer-menu-width)] max-w-[var(--radix-popover-content-available-width)] gap-0 overflow-hidden bg-transparent p-0 shadow-none ring-0",
    className,
  );
}

export function groupedCommandMenuDropdownShellClassName(className?: string) {
  return cn(
    groupedCommandMenuShellClassName(),
    "max-h-[min(var(--grouped-command-menu-panel-height,420px),var(--radix-dropdown-menu-content-available-height))] gap-0 overflow-hidden bg-transparent p-0 shadow-none ring-0",
    className,
  );
}

/**
 * Shared searchable grouped list for composer pickers (project, workspace, host,
 * model). Mesh alignment, overlay scrollbar, checked-row highlight policy,
 * and stable list height are owned here — features only pass groups/items.
 */
export function GroupedCommandMenu({
  groups,
  searchPlaceholder,
  emptyMessage,
  initialHighlightValue = "",
  showSearch = true,
  autoFocus = true,
  listClassName,
  commandClassName,
  panelClassName,
  testId = "grouped-command-menu-panel",
  menuMode = "grouped-command",
  insideDropdownMenu = false,
  listHeightPx = GROUPED_COMMAND_MENU_LIST_HEIGHT_PX,
  panelHeightPx,
  menuResetKey,
  listHeader,
  listHeaderSeparator = true,
}: {
  groups: readonly GroupedCommandMenuGroup[];
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
  panelHeightPx?: number;
  menuResetKey?: string;
  listHeader?: ReactNode;
  listHeaderSeparator?: boolean;
}) {
  const [commandValue, setCommandValue] = useState(initialHighlightValue);
  const { commandRovingProps, onKeyDown: onRovingKeyDown } =
    useGroupedCommandRovingHighlight(menuResetKey ?? initialHighlightValue);

  useEffect(() => {
    setCommandValue(initialHighlightValue);
  }, [initialHighlightValue]);

  const panelStyle = {
    ["--grouped-command-list-height" as string]: `${listHeightPx}px`,
    ...(panelHeightPx
      ? {
          ["--grouped-command-menu-panel-height" as string]: `${panelHeightPx}px`,
        }
      : {}),
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
      className={
        panelClassName ??
        groupedCommandMenuPanelClassName({
          maxHeightPx:
            panelHeightPx ?? GROUPED_COMMAND_MENU_DROPDOWN_PANEL_HEIGHT_PX,
        })
      }
      style={panelStyle}
    >
      <Command
        value={commandValue}
        onValueChange={setCommandValue}
        className={cn(
          "grouped-command-menu size-full min-h-0 overflow-hidden rounded-none! border-0 bg-transparent p-0 shadow-none ring-0",
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
            "grouped-command-menu-scroll sidebar-scroll-area w-full min-h-0",
            listClassName,
          )}
        >
          <CommandList className="max-h-none overflow-visible scroll-py-1 p-0 outline-none">
            <CommandEmpty className="px-3 text-center text-xs leading-relaxed text-fg-subtle">
              {emptyMessage}
            </CommandEmpty>
            {listHeader}
            {listHeader && listHeaderSeparator && groups.length > 0 ? (
              <CommandSeparator />
            ) : null}
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
                    forceMount={item.forceMount}
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
