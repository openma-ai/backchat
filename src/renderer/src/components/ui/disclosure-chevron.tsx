import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function DisclosureChevron({
  open,
  className,
}: {
  open: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("activity-disclosure-chevron", className)}
      data-disclosure-chevron-slot="true"
      aria-hidden="true"
    >
      <ChevronRightIcon
        className={cn(
          "size-3.5 text-fg-subtle transition-transform",
          open && "rotate-90",
        )}
      />
    </span>
  );
}
