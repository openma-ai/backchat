import { ChevronRightIcon } from "@/components/Icons";

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
          // Turns on the same tokens as the body's collapse, so the chevron
          // and the content arrive together (as the sidebar caret does).
          "size-3.5 text-fg-subtle transition-transform duration-[var(--motion-disclosure-duration)] ease-[var(--motion-disclosure-easing)]",
          open && "rotate-90",
        )}
      />
    </span>
  );
}
