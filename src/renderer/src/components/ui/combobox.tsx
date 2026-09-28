import { useId, useState } from "react";
import { ChevronDownIcon } from "@/components/Icons";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "./command";

/** Searchable, bounded choice list built on the same primitives as Cmd K. */
export function Combobox({
  label,
  value,
  onChange,
  options,
  placeholder = "Choose an option",
  emptyMessage = "No matching options.",
  searchPlaceholder = "Search options…",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  emptyMessage?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-haspopup="listbox"
            className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={
                selected ? "truncate" : "truncate text-muted-foreground"
              }
            >
              {selected?.label ??
                (value ? "Choose an available option" : placeholder)}
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
          className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-32px)] overflow-hidden p-0"
        >
          <Command className="border-0! shadow-none! h-auto max-h-[min(320px,var(--radix-popover-content-available-height))]">
            <CommandInput
              aria-label={`Search ${label}`}
              placeholder={searchPlaceholder}
            />
            <CommandList id={listId} className="min-h-0 max-h-64">
              <CommandEmpty>
                {options.length ? "No matching options." : emptyMessage}
              </CommandEmpty>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label]}
                  data-checked={value === option.value}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
