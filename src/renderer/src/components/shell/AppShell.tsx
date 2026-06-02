import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * AppShell — the global floating-card layout. Stage = bg-sidebar, the
 * sidebar sits transparent on it, the card on the right gets its own bg +
 * shadow + rounded-xl corners + a faint border. Right + bottom inset
 * (`pr-2 pb-2`) lets a band of stage show. Matches the taste-saas recipe
 * (references/app-shell.md).
 *
 * Single AppShell instance per window. Children: sidebar (left slot),
 * topbar (breadcrumb / actions) and `main` (the scrollable content).
 */
export function AppShell({
  sidebar,
  topbar,
  children,
  className,
}: {
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid h-full bg-bg-sidebar text-fg",
        "grid-cols-[240px_1fr] grid-rows-[1fr] gap-2 p-2",
        className,
      )}
    >
      <aside className="flex h-full min-h-0 flex-col">
        {sidebar}
      </aside>

      {/* Floating card. No border — elevation is carried by `bg-bg` against
          the slightly darker `bg-bg-sidebar` stage + a soft drop shadow. The
          previous border-border/60 added a hairline that looked like a
          neglected detail; a bare bg + shadow is what Linear/Vercel use. */}
      <div className="flex h-full min-h-0 flex-col">
        <section
          className={cn(
            "relative flex h-full min-h-0 flex-col overflow-hidden",
            "rounded-xl bg-bg",
            "shadow-[0_8px_24px_-12px_rgb(0_0_0/0.10),0_2px_6px_-2px_rgb(0_0_0/0.04)]",
          )}
        >
          {/* Topbar — h-11 baseline matches the sidebar brand row. No
              bottom border; the chat area below has its own padding so a
              hairline rule would just stripe the card. */}
          <header className="app-drag-region flex h-11 shrink-0 items-center pl-4 pr-2">
            {topbar}
          </header>
          <main className="relative min-h-0 flex-1 overflow-y-auto overscroll-y-none">
            {children}
          </main>
        </section>
      </div>
    </div>
  );
}
