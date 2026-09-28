import type { ComponentProps } from "react";
import { SearchIcon } from "@/components/Icons";
import { cn } from "@/lib/utils";

/** Borderless search row shared by menus, settings, and find-in-page. */
export function SearchField({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="search-field"
      className={cn(
        "flex h-9 min-w-0 shrink-0 items-center gap-2 px-2 text-fg-muted focus-within:text-fg [&>input::-webkit-search-cancel-button]:appearance-none [&>input::-webkit-search-decoration]:appearance-none [&>input]:h-full [&>input]:min-w-0 [&>input]:flex-1 [&>input]:border-0 [&>input]:bg-transparent [&>input]:p-0 [&>input]:text-xs [&>input]:text-fg [&>input]:shadow-none [&>input]:outline-none [&>input]:placeholder:text-fg-muted [&>input]:disabled:cursor-not-allowed [&>input]:disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SearchIcon aria-hidden="true" className="pointer-events-none size-3.5 shrink-0" />
      {children}
    </div>
  );
}
