import { forwardRef, type ComponentProps } from "react";
import { COMPOSER_BOX_CLASS } from "@/lib/composer-box";
import { cn } from "@/lib/utils";

/** Shared presentation for session and project composers; hosts own delivery. */
export function ComposerSurface({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "composer-control-row-inset relative flex flex-col gap-[var(--composer-section-gap)] py-[var(--composer-card-padding-block)] composer-card transition-shadow",
        COMPOSER_BOX_CLASS,
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
        "min-h-[var(--composer-body-min-height)] w-full max-h-[240px] resize-none bg-transparent font-chat text-body text-fg outline-none placeholder:text-fg-subtle [field-sizing:content]",
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
        "inline-flex h-7 shrink-0 items-center justify-center rounded-md px-1.5 text-fg-subtle hover:text-fg hover:bg-[var(--control-bg-hover)] disabled:text-fg-disabled disabled:hover:bg-transparent transition-colors",
        className,
      )}
      {...props}
    />
  );
}
