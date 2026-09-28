import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Shared presentation for session and project composers; hosts own delivery. */
export function ComposerSurface({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "composer-control-row-inset composer-radius relative flex flex-col gap-[var(--composer-section-gap)] py-[var(--composer-card-padding-block)] app-composer-surface composer-card transition-shadow",
        className,
      )}
      {...props}
    />
  );
}

export const ComposerInput = forwardRef<
  HTMLTextAreaElement,
  ComponentProps<"textarea">
>(function ComposerInput({ className, rows = 1, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        "min-h-[var(--composer-body-min-height)] w-full max-h-[240px] resize-none bg-transparent font-chat text-[14px] leading-7 text-fg outline-none placeholder:text-fg-muted [field-sizing:content]",
        className,
      )}
      {...props}
    />
  );
});

export function ComposerAction({
  className,
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center rounded-md px-1.5 text-fg-subtle hover:text-fg hover:bg-[var(--control-bg-hover)] disabled:text-fg-subtle/40 disabled:hover:bg-transparent disabled:hover:text-fg-subtle/40 transition-colors",
        className,
      )}
      {...props}
    />
  );
}
