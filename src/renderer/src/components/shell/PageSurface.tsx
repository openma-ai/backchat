import { cn } from "@/lib/utils";

/** Shared scrollable card used by non-chat routes inside AppShell. */
export function PageSurface({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="page-surface"
      className={cn(
        "app-scrollbar h-full overflow-y-auto rounded-2xl bg-bg/80 shadow-card-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}
