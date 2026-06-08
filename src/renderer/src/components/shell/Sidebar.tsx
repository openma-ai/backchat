import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu } from "radix-ui";
import {
  Loader2Icon,
  PinIcon,
  PinOffIcon,
  PencilIcon,
  SearchIcon,
  Settings2Icon,
  SquarePenIcon,
  ArchiveIcon,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  selectActiveId,
  selectSessions,
  sessionStore,
  useSessionStore,
  type SessionRow,
} from "@/lib/session-store";
import { AgentIcon } from "@/components/AgentIcon";
import { useSidebarCollapse } from "@/components/shell/AppShell";

/**
 * Sidebar — top row is a drag region reserved for macOS trafficLight
 * (the red/yellow/green chrome IS the brand mark; we don't draw a logo).
 * Below that: + New chat (button row), Search (Cmd+K trigger), then the
 * scrollable chat list. Bottom: Settings link + theme toggle.
 *
 * Cold-create flow: clicking "+ New chat" navigates to the home route ("/")
 * which shows the empty composer. A draft session is materialized — and
 * the ACP child spawned — only when the user actually submits a prompt.
 * No IPC fires until then. Repeated clicks on "+ New chat" while already
 * on home are a no-op.
 *
 * Everything horizontal pulls from --page-pl so it lines up with the
 * card's first column across the seam. Everything vertical pulls from
 * --row-h / --row-gap-y so heights match the card's toolbar.
 */
export function Sidebar() {
  const sessions = useSessionStore(selectSessions);
  const activeId = useSessionStore(selectActiveId);
  const navigate = useNavigate();
  const location = useLocation();
  const { collapsed } = useSidebarCollapse();
  // Single menu state for the whole sidebar — only one row's `…`
  // dropdown can be open at a time. Lifting this up avoids the
  // "right-click row A then row B leaves both menus open" bug.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const goHome = () => {
    sessionStore.setActive(null);
    void navigate({ to: "/" });
  };

  const onSelectSession = (id: string) => {
    sessionStore.setActive(id);
    void navigate({ to: "/chat/$sessionId", params: { sessionId: id } });
  };

  const settingsActive = location.pathname.startsWith("/settings");
  const onHome = location.pathname === "/";

  // Single class for every collapsible text label in the sidebar — fades
  // out before the column width starts shrinking and fades in after the
  // column finishes growing, so labels never paint into a half-width
  // column (which reads as text being "swept off the edge").
  const labelCls = cn(
    "transition-opacity",
    collapsed
      ? "opacity-0 pointer-events-none"
      : "opacity-100",
    // The truncate keeps text from briefly wrapping during the column
    // resize that follows the opacity transition.
    "truncate",
  );

  // Measure the actual scrollbar gutter width inside the chats nav and
  // mirror it onto the sidebar root as `--sb-w`. New chat / Search /
  // Settings paddings reference this var so their right edges line up
  // with chat rows regardless of OS "show scroll bars" preference
  // (Always vs Automatic). Re-measure when sessions change or window
  // resizes — content height crossing the overflow threshold flips the
  // bar on/off and the var follows.
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const measure = () => {
      const root = sidebarRef.current;
      const nav = navRef.current;
      if (!root || !nav) return;
      // offsetWidth = layout box width, clientWidth = content width
      // (excludes scrollbar). Diff is the bar's gutter px, or 0 if it's
      // an overlay (macOS Automatic) or not present (no overflow).
      const w = nav.offsetWidth - nav.clientWidth;
      root.style.setProperty("--sb-w", `${w}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [sessions.length]);

  return (
    <div ref={sidebarRef} className="flex h-full min-h-0 flex-col">
      {/* TrafficLight drag region — just empty space inside the sidebar
          card so the macOS-drawn trafficLight (at window x=16, y=18)
          has visible padding inside the card's rounded top-left. The
          global toggle button (rendered in AppShell) is absolute-
          positioned just to the right of the trafficLight; we don't
          host it here so it stays in place when the sidebar collapses. */}
      <div
        className="app-drag-region shrink-0"
        style={{ height: "36px" }}
      />

      {/* First content row — the "+ New chat" button. paddingRight
          includes the measured scrollbar gutter width (--sb-w) so its
          right edge matches the chats nav below, regardless of OS
          "show scroll bars" preference. */}
      <div
        className="pt-[var(--row-gap-y)]"
        style={{
          paddingLeft: "8px",
          paddingRight: "calc(8px + var(--sb-w, 0px))",
        }}
      >
        <button
          type="button"
          onClick={goHome}
          aria-label="New chat"
          aria-current={onHome ? "page" : undefined}
          className={cn(
            "app-no-drag flex w-full items-center gap-2 rounded-md px-2 text-left text-xs",
            onHome
              ? "liquid-glass-selected text-fg"
              : "text-fg hover:bg-bg-surface/60",
            "transition-colors",
          )}
          style={{ height: "var(--row-h)" }}
        >
          <span className="inline-flex size-4 shrink-0 items-center justify-center text-fg-muted">
            <SquarePenIcon className="size-3.5" />
          </span>
          <span className={labelCls}>New chat</span>
        </button>

        {/* Cmd+K trigger — fires a synthetic ⌘K so CommandPalette opens.
            Visible in collapsed mode too (just the icon); pressing it
            still opens the palette, which is the actual search surface. */}
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
            )
          }
          aria-label="Open command palette"
          className={cn(
            "app-no-drag mt-0.5 flex w-full items-center gap-2 rounded-md px-2 text-left text-xs",
            "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
            "transition-colors",
          )}
          style={{ height: "var(--row-h)" }}
        >
          <span className="inline-flex size-4 shrink-0 items-center justify-center">
            <SearchIcon className="size-3.5" />
          </span>
          <span className={labelCls}>Search</span>
          <span
            className={cn(
              "ml-auto inline-flex w-6 shrink-0 items-center justify-end font-mono text-[11px] text-fg-subtle",
              labelCls,
            )}
          >
            ⌘K
          </span>
        </button>
      </div>

      {/* Chats — flex-1 takes all remaining space. scrollbarGutter
          permanently reserves the bar's width so rows don't shift left
          when crossing the overflow threshold. Sibling sticky-pinned
          rows (New chat / Search / Settings) carry the same extra
          paddingRight so right edges line up. */}
      <nav
        ref={navRef}
        className="sidebar-scrollbar flex-1 overflow-y-auto pt-[var(--row-gap-y)]"
        style={{
          paddingLeft: "8px",
          paddingRight: "8px",
          scrollbarGutter: "stable",
        }}
      >
        {sessions.length === 0 ? (
          <div>
            <div className={cn("mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle", labelCls)}>
              Chats
            </div>
            <button
              type="button"
              onClick={goHome}
              className="block w-full px-2 py-2 text-left text-xs text-fg-muted hover:text-fg"
            >
              Start a new chat
            </button>
          </div>
        ) : (
          (() => {
            // Split: Pinned (those with pinnedAt) + Chats (rest). Within
            // each group, sort by recency (Sessions arrive pre-ordered from
            // `listSessionsForSidebar` which puts pinned first by pinned_at
            // desc, then unpinned by last_used_at desc). Stable partition.
            const pinned: typeof sessions = [];
            const chats: typeof sessions = [];
            for (const s of sessions) {
              if (s.pinnedAt != null) pinned.push(s);
              else chats.push(s);
            }
            return (
              <>
                {pinned.length > 0 && (
                  <div className="mb-3">
                    <div className={cn("mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle", labelCls)}>
                      Pinned
                    </div>
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {pinned.map((s) => (
                        <li key={s.id}>
                          <SessionRow
                            row={s}
                            active={s.id === activeId && location.pathname.startsWith("/chat/")}
                            labelCls={labelCls}
                            onSelect={() => onSelectSession(s.id)}
                            menuOpen={openMenuId === s.id}
                            onMenuOpenChange={(open) =>
                              setOpenMenuId(open ? s.id : null)
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {chats.length > 0 && (
                  <div>
                    <div className={cn("mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle", labelCls)}>
                      Chats
                    </div>
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {chats.map((s) => (
                        <li key={s.id}>
                          <SessionRow
                            row={s}
                            active={s.id === activeId && location.pathname.startsWith("/chat/")}
                            labelCls={labelCls}
                            onSelect={() => onSelectSession(s.id)}
                            menuOpen={openMenuId === s.id}
                            onMenuOpenChange={(open) =>
                              setOpenMenuId(open ? s.id : null)
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            );
          })()
        )}
      </nav>

      {/* Footer — Settings link only. paddingRight matches the New chat
          row above via --sb-w. */}
      <div
        className="pb-[var(--row-gap-y)]"
        style={{
          paddingLeft: "8px",
          paddingRight: "calc(8px + var(--sb-w, 0px))",
        }}
      >
        <Link
          to="/settings"
          aria-label="Settings"
          className={cn(
            "app-no-drag flex w-full items-center gap-2 rounded-md px-2 text-xs",
            settingsActive
              ? "liquid-glass-selected text-fg"
              : "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
          )}
          style={{ height: "var(--row-h)" }}
        >
          <span className="inline-flex size-4 shrink-0 items-center justify-center">
            <Settings2Icon className="size-3.5" />
          </span>
          <span className={labelCls}>Settings</span>
        </Link>
      </div>
    </div>
  );
}

/** Session row — plain button, no Radix trickery. The `…` icon is a
 *  SEPARATE button inside the row that owns its own DropdownMenu
 *  state via a controlled `open` prop. This sidesteps every issue
 *  we hit trying to wrap the row in a DropdownMenuTrigger (Radix
 *  wants one child, right-click wiring fights the row click,
 *  controlled-vs-uncontrolled state bugs). Trades: clicking `…`
 *  doesn't also navigate (stopPropagation on the button), and the
 *  menu opens via a pure onClick handler. */
function SessionRow({
  row,
  active,
  labelCls,
  onSelect,
  menuOpen,
  onMenuOpenChange,
}: {
  row: SessionRow;
  active: boolean;
  labelCls: string;
  onSelect: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const running = row.status === "running" || row.status === "starting";
  const errored = row.status === "errored";
  const pinned = row.pinnedAt != null;
  const setMenuOpen = onMenuOpenChange;

  // The two menu surfaces (DropdownMenu for the `…` button, ContextMenu
  // for right-click) use different Radix React contexts — Item/
  // Separator from one don't render inside the other. Rather than
  // build an abstraction over both, inline the same item structure
  // twice. Less clever, more readable.

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className={cn(
            "group relative flex w-full items-center gap-2 rounded-md px-2 text-xs",
            errored && "text-danger",
            active
              ? "liquid-glass-selected text-fg"
              : !errored && "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
            "transition-colors",
          )}
          style={{ height: "var(--row-h)" }}
        >
          <button
            type="button"
            onClick={onSelect}
            title={row.lastError ?? row.agent_id}
            aria-label={row.label}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {row.agent_id ? (
              <AgentIcon agentId={row.agent_id} className="size-3.5 shrink-0 text-fg-muted group-hover:text-fg" title={row.agent_id} />
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            <span className={cn("flex-1 truncate text-left", labelCls)}>{row.label}</span>
          </button>

          <span className="ml-auto inline-flex w-5 shrink-0 items-center justify-end">
            {running ? (
              <Loader2Icon className="size-3 animate-spin text-fg-subtle" />
            ) : !active && row.unread ? (
              <span className="size-1.5 rounded-full" style={{ backgroundColor: "oklch(0.62 0.16 240)" }} />
            ) : (
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Session actions"
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "flex size-4 items-center justify-center rounded text-fg-muted transition-opacity hover:bg-bg-surface/80 hover:text-fg",
                      menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={4} className="w-fit min-w-[140px]">
                  <DropdownMenuItem
                    onSelect={() => (pinned ? sessionStore.unpin(row.id) : sessionStore.pin(row.id))}
                    className="flex items-center gap-2 py-1 text-xs"
                  >
                    {pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
                    <span>{pinned ? "Unpin" : "Pin"}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => { /* Rename TBD */ }}
                    className="flex items-center gap-2 py-1 text-xs"
                  >
                    <PencilIcon className="size-3.5" />
                    <span>Rename</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1 h-px bg-border/60" />
                  <DropdownMenuItem
                    onSelect={() => sessionStore.archive(row.id)}
                    className="flex items-center gap-2 py-1 text-xs"
                  >
                    <ArchiveIcon className="size-3.5" />
                    <span>Archive</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </span>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-50 w-fit min-w-[140px] overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ContextMenu.Item
            onSelect={() => (pinned ? sessionStore.unpin(row.id) : sessionStore.pin(row.id))}
            className="flex cursor-default select-none items-center gap-2 rounded-md px-1.5 py-1 text-xs outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            {pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
            <span>{pinned ? "Unpin" : "Pin"}</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={() => { /* Rename TBD */ }}
            className="flex cursor-default select-none items-center gap-2 rounded-md px-1.5 py-1 text-xs outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <PencilIcon className="size-3.5" />
            <span>Rename</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-border/60" />
          <ContextMenu.Item
            onSelect={() => sessionStore.archive(row.id)}
            className="flex cursor-default select-none items-center gap-2 rounded-md px-1.5 py-1 text-xs outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <ArchiveIcon className="size-3.5" />
            <span>Archive</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
