import { useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/Icons";
import { GroupedCommandMenu } from "@/components/ui/grouped-command-menu";
import {
  GroupedCommandMenuIconSlot,
  GroupedCommandMenuLabelSlot,
} from "@/components/ui/grouped-command-menu-slots";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const GROUPED_COMMAND_FIELD_LIST_HEIGHT_PX = 240;
export const GROUPED_COMMAND_FIELD_PANEL_HEIGHT_PX = 288;

export type GroupedCommandFieldOption = {
  value: string;
  label: string;
  keywords?: string[];
  disabled?: boolean;
  leading?: ReactNode;
};

/** Form/settings select: shared trigger chrome + `GroupedCommandMenu` list. */
export function GroupedCommandField({
  label,
  value,
  onChange,
  options,
  placeholder = "Choose an option",
  emptyMessage = "No matching options.",
  searchPlaceholder = "Search…",
  disabled,
  searchThreshold = 8,
  testId,
  listHeightPx = GROUPED_COMMAND_FIELD_LIST_HEIGHT_PX,
  panelHeightPx = GROUPED_COMMAND_FIELD_PANEL_HEIGHT_PX,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly GroupedCommandFieldOption[];
  placeholder?: string;
  emptyMessage?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  searchThreshold?: number;
  testId?: string;
  listHeightPx?: number;
  panelHeightPx?: number;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const showSearch =
    options.length >= searchThreshold ||
    options.some((option) => (option.keywords?.length ?? 0) > 1);

  const groups = useMemo(
    () => [
      {
        items: options.map((option) => ({
          id: option.value,
          value: option.value,
          keywords: option.keywords ?? [option.label, option.value],
          checked: option.value === value,
          disabled: option.disabled,
          title: option.label,
          onSelect: () => {
            if (option.disabled) return;
            onChange(option.value);
            setOpen(false);
          },
          children: (
            <>
              <GroupedCommandMenuIconSlot>
                {option.leading ?? <span className="size-3.5" aria-hidden />}
              </GroupedCommandMenuIconSlot>
              <GroupedCommandMenuLabelSlot>
                <span className="truncate">{option.label}</span>
              </GroupedCommandMenuLabelSlot>
            </>
          ),
        })),
      },
    ],
    [onChange, options, value],
  );

  return (
    <div
      className="grouped-command-field grid gap-2"
      data-open={open ? "true" : "false"}
      data-testid={testId}
    >
      <span className="text-sm font-medium">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-haspopup="listbox"
            disabled={disabled}
            className="grouped-command-field-trigger"
          >
            <span className="grouped-command-field-trigger-leading">
              {selected?.leading ?? (
                <span className="size-3.5 shrink-0" aria-hidden />
              )}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-left",
                !selected && "text-muted-foreground",
              )}
            >
              {selected?.label ??
                (value ? "Choose an available option" : placeholder)}
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={0}
          collisionPadding={8}
          style={
            {
              "--grouped-command-field-panel-height": `${panelHeightPx}px`,
            } as CSSProperties
          }
          className="grouped-command-field-popover w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-32px)]"
        >
          <GroupedCommandMenu
            testId={listId}
            menuMode="grouped-command-field"
            menuResetKey={open ? "open" : "closed"}
            groups={groups}
            searchPlaceholder={searchPlaceholder}
            searchInputAriaLabel={`Search ${label}`}
            emptyMessage={emptyMessage}
            showSearch={showSearch}
            initialHighlightValue={selected?.value ?? value}
            listHeightPx={listHeightPx}
            panelHeightPx={panelHeightPx}
            panelClassName={cn(
              "flex h-auto min-h-0 max-h-[min(var(--grouped-command-field-panel-height),var(--radix-popover-content-available-height))] flex-col overflow-hidden",
            )}
            commandClassName="rounded-xl rounded-t-none border border-border border-t-0 bg-popover text-popover-foreground shadow-none ring-0"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
