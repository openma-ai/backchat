import { cn } from "@/lib/utils";

/**
 * Conversation rows and settings nav items share this class.
 * Height is `var(--sidebar-row-h)` on `.sidebar-nav-row`. The 28px
 * navigation rhythm is the `.sidebar-navigation` override of that
 * token, so both sidebars have to render inside `.sidebar-navigation`.
 */
export const SIDEBAR_NAV_ROW_CLASS =
  "sidebar-nav-row flex w-full items-center gap-2 rounded-md px-2 text-ui transition-colors";

/** Selected and hover classes copied from the session row. */
export function sidebarNavRowStateClass(state: {
  active: boolean;
  errored?: boolean;
}): string {
  const errored = state.errored === true;
  if (state.active) {
    return cn(errored && "text-danger", "app-selected-surface text-fg");
  }
  if (errored) return "text-danger";
  return "text-fg-muted hover:bg-[var(--control-bg-hover)] hover:text-fg";
}

export function sidebarNavRowClass(state: {
  active: boolean;
  errored?: boolean;
  className?: string;
}): string {
  return cn(
    SIDEBAR_NAV_ROW_CLASS,
    sidebarNavRowStateClass(state),
    state.className,
  );
}
