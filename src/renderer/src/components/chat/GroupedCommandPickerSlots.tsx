import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Leading icon column — lines up with the search row magnifier (sidebar icon track). */
export function GroupedCommandPickerIconSlot({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-grouped-command-grid="icon"
      className={cn(
        "flex items-center justify-center text-fg-subtle [&_svg]:size-3.5",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Primary label column (optional hint stacks under the title). */
export function GroupedCommandPickerLabelSlot({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-grouped-command-grid="label"
      className={cn("min-w-0 flex flex-col justify-center", className)}
    >
      {children}
    </span>
  );
}
