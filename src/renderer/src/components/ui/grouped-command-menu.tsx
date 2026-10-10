import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
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
  /** Renders `CommandSeparator` immediately above this group (main project picker parity). */
  separatorBefore?: boolean;
  items: readonly GroupedCommandMenuItem[];
};

/** cmdk owns filter + best-match ranking for every mode (project order uses indexed values). */
export function groupedCommandMenuShouldFilter(_menuMode?: string): boolean {
  return true;
}

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
    "flex h-auto w-full flex-col overflow-hidden",
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
  searchInputAriaLabel,
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
  shrinkToContent = false,
  nativeListScroll = false,
}: {
  groups: readonly GroupedCommandMenuGroup[];
  searchPlaceholder: string;
  searchInputAriaLabel?: string;
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
  /** Drop flex growth so panel height follows row count (host picker). */
  shrinkToContent?: boolean;
  /** Scroll on `CommandList` (host picker — matches main dropdown `overflow-y-auto`). */
  nativeListScroll?: boolean;
}) {
  const highlightFromChecked = useMemo(() => {
    for (const group of groups) {
      for (const item of group.items) {
        if (item.checked) return item.value;
      }
    }
    return "";
  }, [groups]);
  const effectiveHighlightValue = useMemo(() => {
    const itemValues = new Set(
      groups.flatMap((group) => group.items.map((item) => item.value)),
    );
    if (
      initialHighlightValue &&
      itemValues.has(initialHighlightValue)
    ) {
      return initialHighlightValue;
    }
    if (highlightFromChecked) return highlightFromChecked;
    return initialHighlightValue;
  }, [groups, highlightFromChecked, initialHighlightValue]);

  const [commandValue, setCommandValue] = useState(effectiveHighlightValue);
  const [searchQuery, setSearchQuery] = useState("");
  const commandRootRef = useRef<HTMLDivElement>(null);
  const { commandRovingProps, onKeyDown: onRovingKeyDown } =
    useGroupedCommandRovingHighlight(
      menuResetKey ?? effectiveHighlightValue,
    );

  useEffect(() => {
    if (showSearch || menuResetKey !== "open") return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        commandRootRef.current?.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [menuResetKey, showSearch]);

  const shouldFilter = groupedCommandMenuShouldFilter(menuMode);

  useEffect(() => {
    setCommandValue(effectiveHighlightValue);
    setSearchQuery("");
  }, [effectiveHighlightValue, menuResetKey]);

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

  /** Main CommandList: tail rows are siblings, not a padded `CommandGroup`. */
  const bareListGroupItems =
    menuMode === "project-picker"
    || menuMode === "workspace-picker"
    || menuMode === "host-picker";

  const renderMenuItem = (item: GroupedCommandMenuItem) => (
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
      className={cn(
        "text-xs",
        menuMode === "host-picker" &&
          "host-picker-command-item !items-start !py-1 !px-2",
      )}
    >
      {item.children}
    </CommandItem>
  );

  const renderGroup = (group: GroupedCommandMenuGroup, index: number) => {
    const key = group.heading ?? `__ungrouped-${index}`;
    const items = group.items.map((item) => renderMenuItem(item));
    if (bareListGroupItems && !group.heading) {
      return (
        <Fragment key={key}>
          {group.separatorBefore ? <CommandSeparator /> : null}
          {items}
        </Fragment>
      );
    }
    if (group.heading) {
      return (
        <Fragment key={key}>
          {group.separatorBefore ? <CommandSeparator /> : null}
          <div className={bareListGroupItems ? "px-0 py-1" : "px-0"}>
            <div
              data-grouped-command-group-heading=""
              className="text-xs font-medium text-muted-foreground py-1.5 pe-[var(--grouped-command-padding-inline)] ps-[length:calc(var(--grouped-command-padding-inline)+var(--grouped-command-icon-track)+var(--grouped-command-column-gap))]"
            >
              {group.heading}
            </div>
            <CommandGroup className="!p-0">{items}</CommandGroup>
          </div>
        </Fragment>
      );
    }
    return (
      <Fragment key={key}>
        {group.separatorBefore ? <CommandSeparator /> : null}
        <CommandGroup>{items}</CommandGroup>
      </Fragment>
    );
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
        ref={commandRootRef}
        tabIndex={showSearch ? undefined : 0}
        loop
        value={commandValue}
        onValueChange={setCommandValue}
        shouldFilter={shouldFilter}
        className={cn(
          "grouped-command-menu flex min-h-0 flex-col overflow-hidden rounded-none! border-0 bg-transparent p-0 shadow-none ring-0",
          shrinkToContent ? "h-auto flex-none" : "flex-1",
          commandClassName,
        )}
        {...commandRovingProps}
        onKeyDown={mergeRovingKeyDown}
      >
        {showSearch ? (
          <CommandInput
            autoFocus={autoFocus}
            placeholder={searchPlaceholder}
            aria-label={searchInputAriaLabel ?? searchPlaceholder}
            value={searchQuery}
            onValueChange={setSearchQuery}
            onKeyDown={mergeRovingKeyDown}
          />
        ) : null}
        {nativeListScroll ? (
          <CommandList
            className={cn(
              menuMode === "host-picker"
                ? "max-h-none overflow-visible scroll-py-0 p-0 outline-none"
                : menuMode === "project-picker" || menuMode === "workspace-picker"
                  ? "no-scrollbar max-h-72 overflow-x-hidden overflow-y-auto scroll-py-1 p-0 outline-none"
                  : "oma-scrollbar max-h-[60vh] overflow-y-auto scroll-py-1 p-0 outline-none",
              listClassName,
            )}
          >
            <CommandEmpty className="px-3 text-center text-xs leading-relaxed text-fg-subtle">
              {emptyMessage}
            </CommandEmpty>
            {listHeader}
            {listHeader && listHeaderSeparator && groups.length > 0 ? (
              <CommandSeparator />
            ) : null}
            {groups.map(renderGroup)}
          </CommandList>
        ) : (
          <ScrollArea
            className={cn(
              "grouped-command-menu-scroll sidebar-scroll-area w-full",
              shrinkToContent ? "h-auto flex-none" : "min-h-0 flex-1",
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
              {groups.map(renderGroup)}
            </CommandList>
          </ScrollArea>
        )}
      </Command>
    </div>
  );
}
