import type { ReactNode } from "react";
import { PageSurface } from "@/components/shell/PageSurface";
import { cn } from "@/lib/utils";

/** Outer inset used by settings and other content pages inside PageSurface. */
export const PAGE_INSET_CLASS = "w-full px-8 pb-16 pt-20";

/** Inner column: slightly narrower than the old 960px settings measure. */
export const PAGE_SCAFFOLD_CLASS = "mx-auto max-w-[800px] space-y-8 text-xs";

export function ContentPage({ children }: { children: ReactNode }) {
  return (
    <PageSurface>
      <div className={PAGE_INSET_CLASS}>{children}</div>
    </PageSurface>
  );
}

export function PageScaffold({
  title,
  description,
  meta,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={PAGE_SCAFFOLD_CLASS}>
      <header className={cn(actions && "flex items-start justify-between gap-4")}>
        <div className="min-w-0">
          <h1 className="text-2xl font-medium tracking-[-0.02em] text-fg">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-[68ch] text-xs leading-5 text-fg-muted">{description}</p>
          ) : null}
          {meta}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
