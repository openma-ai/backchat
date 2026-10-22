import { cn } from "@/lib/utils";

/** Solid disclosure triangle for quiet group labels (worktrees). A filled
 *  8px caret reads at caption size where a 1.75-stroke chevron turns into
 *  noise; it is the one solid shape the sidebar uses besides dots. */
export function DisclosureCaret({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 8 8"
      aria-hidden="true"
      data-disclosure-caret="true"
      className={cn(
        "size-2 shrink-0 fill-current transition-transform duration-[var(--motion-disclosure-duration)] ease-[var(--motion-disclosure-easing)]",
        open && "rotate-90",
        className,
      )}
    >
      <path d="M2.6 1.45c0-.42.5-.64.81-.36l2.86 2.55c.22.2.22.54 0 .74L3.41 6.93c-.31.28-.81.06-.81-.36z" />
    </svg>
  );
}
