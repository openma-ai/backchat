import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu } from "radix-ui";
import {
  CheckIcon,
  ChevronRightIcon,
  CpuIcon,
  Loader2Icon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  Settings2Icon,
  SquarePenIcon,
  ArchiveIcon,
  CalendarClockIcon,
  FolderIcon,
  FolderOpenIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { enabledAgentIds, isAgentRunnable } from "@/lib/enabled-agents";
import { useSettings } from "@/lib/settings-store";
import {
  selectActiveId,
  selectPairs,
  selectSessions,
  sessionStore,
  useSessionStore,
  type PairRow,
  type SessionRow,
} from "@/lib/session-store";
import { AgentIcon } from "@/components/AgentIcon";
import { AnimatedCollapse } from "@/components/ui/animated-collapse";
import { useSidebarCollapse } from "@/components/shell/AppShell";
import { folderName, projectKeyForCwd } from "@/lib/project-path";
import { useI18n } from "@/lib/i18n";

export interface SidebarProjectGroup {
  key: string;
  label: string;
  sessions: SessionRow[];
}

type SidebarSectionKey = "pinned" | "pairs" | "projects" | "chats";

export function groupSidebarSessions(sessions: SessionRow[]): {
  pinned: SessionRow[];
  projects: SidebarProjectGroup[];
  chats: SessionRow[];
} {
  const pinned: SessionRow[] = [];
  const chats: SessionRow[] = [];
  const projectMap = new Map<string, SidebarProjectGroup>();

  for (const session of sessions) {
    if (session.pinnedAt != null) {
      pinned.push(session);
      continue;
    }

    if (session.projectScope === "none") {
      chats.push(session);
      continue;
    }

    const projectKey = projectKeyForCwd(session.cwd);
    if (!projectKey) {
      chats.push(session);
      continue;
    }

    const group = projectMap.get(projectKey);
    if (group) {
      group.sessions.push(session);
    } else {
      projectMap.set(projectKey, {
        key: projectKey,
        label: folderName(projectKey),
        sessions: [session],
      });
    }
  }

  return {
    pinned,
    projects: [...projectMap.values()],
    chats,
  };
}

/**
 * Sidebar — top row is a drag region reserved for macOS trafficLight
 * (the red/yellow/green chrome IS the brand mark; we don't draw a logo).
 * Below that: + New chat (button row), Search (Cmd+K trigger), then the
 * scrollable chat list. Bottom: Settings link + theme toggle.
 *
 * Cold-create flow: clicking "+ New chat" creates an in-memory global draft
 * and navigates to its empty composer. No IPC fires until the first prompt.
 * Project `+` uses the same draft path with an explicit project scope, so
 * ownership never depends on whichever session happened to be active before.
 *
 * Everything horizontal pulls from --page-pl so it lines up with the
 * card's first column across the seam. Everything vertical pulls from
 * --row-h / --row-gap-y so heights match the card's toolbar.
 */
export function Sidebar() {
  const { t } = useI18n();
  const sessions = useSessionStore(selectSessions);
  const pairs = useSessionStore(selectPairs);
  const activeId = useSessionStore(selectActiveId);
  const navigate = useNavigate();
  const location = useLocation();
  const { collapsed } = useSidebarCollapse();
  // Single menu state for the whole sidebar — only one row's `…`
  // dropdown can be open at a time. Lifting this up avoids the
  // "right-click row A then row B leaves both menus open" bug.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openProjectKeys, setOpenProjectKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [openSectionKeys, setOpenSectionKeys] = useState<Set<SidebarSectionKey>>(
    () => new Set(["pinned", "pairs", "projects", "chats"]),
  );
  const grouped = useMemo(() => groupSidebarSessions(sessions), [sessions]);

  const goHome = () => {
    const id = sessionStore.newDraft();
    void navigate({ to: "/chat/$sessionId", params: { sessionId: id } });
  };

  const onSelectSession = (id: string) => {
    sessionStore.setActive(id);
    void navigate({ to: "/chat/$sessionId", params: { sessionId: id } });
  };

  const onSelectPair = (id: string) => {
    sessionStore.setActive(null);
    void navigate({ to: "/pair/$pairId", params: { pairId: id } });
  };

  const onNewProjectChat = (cwd: string) => {
    const id = sessionStore.newDraft(cwd);
    void navigate({ to: "/chat/$sessionId", params: { sessionId: id } });
  };

  const settingsActive = location.pathname.startsWith("/settings");
  const scheduledActive = location.pathname === "/scheduled";
  const activePairId = location.pathname.startsWith("/pair/")
    ? decodeURIComponent(location.pathname.slice("/pair/".length))
    : null;
  const onHome = location.pathname === "/";
  const activeRow = activeId ? sessionStore.get(activeId) : undefined;
  const newChatActive =
    onHome ||
    (activeRow?.status === "draft" && activeRow.projectScope === "none");
  useEffect(() => {
    if (!activeId) return;
    const activeProject = grouped.projects.find((group) =>
      group.sessions.some((session) => session.id === activeId),
    );
    if (!activeProject) return;
    setOpenProjectKeys((prev) => {
      if (prev.has(activeProject.key)) return prev;
      const next = new Set(prev);
      next.add(activeProject.key);
      return next;
    });
  }, [activeId, grouped.projects]);

  const toggleProject = (key: string) => {
    setOpenProjectKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSection = (key: SidebarSectionKey) => {
    setOpenSectionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
  // bar on/off and the var follows. ResizeObserver already reports the
  // nav's height changes during a window resize, so a second global resize
  // listener would only force the same layout read twice per frame.
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
    return () => {
      ro.disconnect();
    };
  }, [sessions.length, pairs.length]);

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
          data-testid="new-chat-button"
          onClick={goHome}
          aria-label={t("sidebar.newChat")}
          aria-current={newChatActive ? "page" : undefined}
          className={cn(
            "app-no-drag flex w-full items-center gap-2 rounded-md px-2 text-left text-xs",
            newChatActive
              ? "liquid-glass-selected text-fg"
              : "text-fg hover:bg-bg-surface/60",
            "transition-colors",
          )}
          style={{ height: "var(--row-h)" }}
        >
          <span className="inline-flex size-4 shrink-0 items-center justify-center text-fg-muted">
            <SquarePenIcon className="size-3.5" />
          </span>
          <span className={labelCls}>{t("sidebar.newChat")}</span>
        </button>

        <PairChatLauncher labelCls={labelCls} />

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
          aria-label={t("sidebar.search")}
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
          <span className={labelCls}>{t("sidebar.search")}</span>
          <span
            className={cn(
              "ml-auto inline-flex w-6 shrink-0 items-center justify-end font-mono text-[11px] text-fg-subtle",
              labelCls,
            )}
          >
            ⌘K
          </span>
        </button>

        <Link
          to="/scheduled"
          aria-label={t("sidebar.scheduled")}
          className={cn(
            "app-no-drag mt-0.5 flex w-full items-center gap-2 rounded-md px-2 text-xs",
            scheduledActive
              ? "liquid-glass-selected text-fg"
              : "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
          )}
          style={{ height: "var(--row-h)" }}
        >
          <span className="inline-flex size-4 shrink-0 items-center justify-center">
            <CalendarClockIcon className="size-3.5" />
          </span>
          <span className={labelCls}>{t("sidebar.scheduled")}</span>
        </Link>
      </div>

      {/* Chats — flex-1 takes all remaining space. The scrollbar is overlay-
          styled; do not reserve a classic gutter here, because macOS draws
          that gutter as bright vertical seams while the thumb is active. */}
      <nav
        ref={navRef}
        className="sidebar-scrollbar flex-1 overflow-y-auto pt-[var(--row-gap-y)]"
        style={{
          paddingLeft: "8px",
          paddingRight: "8px",
        }}
      >
        {sessions.length === 0 && pairs.length === 0 ? (
          <div>
            <div className={cn("mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle", labelCls)}>
              {t("sidebar.chats")}
            </div>
            <button
              type="button"
              onClick={goHome}
              className="block w-full px-2 py-2 text-left text-xs text-fg-muted hover:text-fg"
            >
              {t("sidebar.startNewChat")}
            </button>
          </div>
        ) : (
          (() => {
            const { pinned, projects, chats } = grouped;
            return (
              <>
                {pinned.length > 0 && (
                  <SidebarSection
                    title={t("sidebar.pinned")}
                    open={openSectionKeys.has("pinned")}
                    onToggle={() => toggleSection("pinned")}
                    labelCls={labelCls}
                  >
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
                  </SidebarSection>
                )}
                {pairs.length > 0 && (
                  <SidebarSection
                    title={t("sidebar.pairs")}
                    open={openSectionKeys.has("pairs")}
                    onToggle={() => toggleSection("pairs")}
                    labelCls={labelCls}
                  >
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {pairs.map((p) => (
                        <li key={p.id}>
                          <PairSidebarRow
                            row={p}
                            active={p.id === activePairId}
                            labelCls={labelCls}
                            onSelect={() => onSelectPair(p.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  </SidebarSection>
                )}
                {projects.length > 0 && (
                  <SidebarSection
                    title={t("sidebar.projects")}
                    open={openSectionKeys.has("projects")}
                    onToggle={() => toggleSection("projects")}
                    labelCls={labelCls}
                  >
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {projects.map((project) => {
                        const open = openProjectKeys.has(project.key);
                        return (
                          <li key={project.key}>
                            <ProjectSidebarRow
                              group={project}
                              open={open}
                              labelCls={labelCls}
                              onToggle={() => toggleProject(project.key)}
                              onNewChat={() => onNewProjectChat(project.key)}
                              onArchiveChats={() => {
                                project.sessions.forEach((session) =>
                                  sessionStore.archive(session.id),
                                );
                              }}
                              menuOpen={openMenuId === `project:${project.key}`}
                              onMenuOpenChange={(openMenu) =>
                                setOpenMenuId(
                                  openMenu ? `project:${project.key}` : null,
                                )
                              }
                            />
                            <AnimatedCollapse open={open}>
                              <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0 pl-4">
                                {project.sessions.map((s) => (
                                  <li key={s.id}>
                                    <SessionRow
                                      row={s}
                                      active={s.id === activeId && location.pathname.startsWith("/chat/")}
                                      labelCls={labelCls}
                                      onSelect={() => onSelectSession(s.id)}
                                      menuOpen={openMenuId === s.id}
                                      onMenuOpenChange={(openMenu) =>
                                        setOpenMenuId(openMenu ? s.id : null)
                                      }
                                    />
                                  </li>
                                ))}
                              </ul>
                            </AnimatedCollapse>
                          </li>
                        );
                      })}
                    </ul>
                  </SidebarSection>
                )}
                {chats.length > 0 && (
                  <SidebarSection
                    title={t("sidebar.chats")}
                    open={openSectionKeys.has("chats")}
                    onToggle={() => toggleSection("chats")}
                    labelCls={labelCls}
                    last
                  >
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
                  </SidebarSection>
                )}
              </>
            );
          })()
        )}
      </nav>

      {/* Footer — Settings link only. Symmetric vertical padding keeps the
          row centered in the footer; paddingRight matches the New chat row
          above via --sb-w. */}
      <div
        className="py-[var(--row-gap-y)]"
        style={{
          paddingLeft: "8px",
          paddingRight: "calc(8px + var(--sb-w, 0px))",
        }}
      >
        <Link
          to="/settings"
          aria-label={t("sidebar.settings")}
          className={cn(
            "app-no-drag flex w-full items-center gap-2 rounded-md px-2 text-xs",
            settingsActive
              ? "liquid-glass-selected text-fg"
              : "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
          )}
          style={{ height: "var(--row-h)" }}
        >
          <Settings2Icon className="size-3.5 shrink-0" />
          <span className={labelCls}>{t("sidebar.settings")}</span>
        </Link>
      </div>
    </div>
  );
}

function SidebarSection({
  title,
  open,
  onToggle,
  labelCls,
  last = false,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  labelCls: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={last ? undefined : "mb-3"}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={title}
        aria-expanded={open}
        className={cn(
          "app-no-drag group mb-1 flex min-h-5 w-full items-center gap-1 rounded px-2 text-left",
          "text-[11px] font-medium tracking-wider text-fg-subtle",
          "hover:bg-bg-surface/40 hover:text-fg-muted active:bg-bg-surface/60",
          "transition-colors duration-[var(--dur-quick)] ease-[var(--ease-snap)]",
        )}
      >
        <span className={cn("min-w-0 truncate", labelCls)}>{title}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 transition-transform duration-[var(--motion-disclosure-duration)] ease-[var(--motion-disclosure-easing)]",
            open && "rotate-90",
            labelCls,
          )}
        />
      </button>
      <AnimatedCollapse open={open}>{children}</AnimatedCollapse>
    </section>
  );
}

function ProjectSidebarRow({
  group,
  open,
  labelCls,
  onToggle,
  onNewChat,
  onArchiveChats,
  menuOpen,
  onMenuOpenChange,
}: {
  group: SidebarProjectGroup;
  open: boolean;
  labelCls: string;
  onToggle: () => void;
  onNewChat: () => void;
  onArchiveChats: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const ProjectIcon = open ? FolderOpenIcon : FolderIcon;
  return (
    <div
      className={cn(
        "app-no-drag group flex w-full items-center gap-2 rounded-md px-2 text-left text-xs",
        "text-fg-muted hover:bg-bg-surface/60 hover:text-fg active:bg-bg-surface/80",
        "transition-colors",
      )}
      style={{ height: "var(--row-h)" }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={group.label}
        aria-expanded={open}
        title={group.key}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <ProjectIcon className="size-3.5 shrink-0 text-fg-muted group-hover:text-fg" />
        <span className={cn("min-w-0 flex-1 truncate", labelCls)}>
          {group.label}
        </span>
      </button>
      <span
        className={cn(
          labelCls,
          "ml-auto inline-flex shrink-0 items-center gap-0.5 transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-snap)]",
          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("sidebar.projectActions")}
              className="flex size-5 items-center justify-center rounded text-fg-muted hover:bg-bg-surface/80 hover:text-fg"
            >
              <span aria-hidden="true">⋯</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={4}
            className="w-fit min-w-[160px]"
          >
            <DropdownMenuItem
              onSelect={() =>
                void window.backchat.uiFsOpenPath({ path: group.key })
              }
              className="flex items-center gap-2 py-1 text-xs"
            >
              <FolderOpenIcon className="size-3.5" />
              <span>{t("sidebar.revealProject")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 h-px bg-border/60" />
            <DropdownMenuItem
              onSelect={onArchiveChats}
              className="flex items-center gap-2 py-1 text-xs"
            >
              <ArchiveIcon className="size-3.5" />
              <span>{t("sidebar.archiveProjectChats")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={t("sidebar.startProjectChat")}
          title={t("sidebar.startProjectChat")}
          onClick={onNewChat}
          className="flex size-5 items-center justify-center rounded text-fg-muted hover:bg-bg-surface/80 hover:text-fg"
        >
          <SquarePenIcon className="size-3.5" />
        </button>
      </span>
    </div>
  );
}

function PairSidebarRow({
  row,
  active,
  labelCls,
  onSelect,
}: {
  row: PairRow;
  active: boolean;
  labelCls: string;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={row.label || t("sidebar.pairChat")}
      className={cn(
        "app-no-drag group flex w-full items-center gap-2 rounded-md px-2 text-left text-xs",
        active
          ? "liquid-glass-selected text-fg"
          : "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
        "transition-colors",
      )}
      style={{ height: "var(--row-h)" }}
    >
      <UsersRoundIcon className="size-3.5 shrink-0 text-fg-muted group-hover:text-fg" />
      <span className={cn("min-w-0 flex-1 truncate", labelCls)}>
        {row.label || t("sidebar.pairChat")}
      </span>
      {row.activeTurnId && (
        <Loader2Icon className="size-3 shrink-0 animate-spin text-fg-subtle" />
      )}
    </button>
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
  const { t } = useI18n();
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
                    aria-label={t("sidebar.sessionActions")}
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
                    <span>{pinned ? t("sidebar.unpin") : t("sidebar.pin")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1 h-px bg-border/60" />
                  <DropdownMenuItem
                    onSelect={() => sessionStore.archive(row.id)}
                    className="flex items-center gap-2 py-1 text-xs"
                  >
                    <ArchiveIcon className="size-3.5" />
                    <span>{t("sidebar.archive")}</span>
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
            <span>{pinned ? t("sidebar.unpin") : t("sidebar.pin")}</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-border/60" />
          <ContextMenu.Item
            onSelect={() => sessionStore.archive(row.id)}
            className="flex cursor-default select-none items-center gap-2 rounded-md px-1.5 py-1 text-xs outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <ArchiveIcon className="size-3.5" />
            <span>{t("sidebar.archive")}</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** Inline multi-Agent chat launcher — sits under the New chat button in
 *  the sidebar. Click reveals a small popover listing every detected
 *  agent with a checkbox; user picks 2-4 then "Start" mints a pair
 *  and routes to /pair/<id>.
 *
 *  Deliberately compact: no modal, no fancy filtering. If the user
 *  has 3 detected agents and wants a pair, two clicks total.
 */
function PairChatLauncher({ labelCls }: { labelCls: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const settings = useSettings();
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: () => window.backchat.agentsList(),
    enabled: open,
  });
  const enabled = agents.filter((a) => enabledAgentIds(settings).has(a.id) && isAgentRunnable(a));

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 4) next.add(id);
      return next;
    });
  };

  const start = () => {
    if (picked.size < 2) return;
    const agentIds = enabled
      .map((a) => a.id)
      .filter((id) => picked.has(id));
    const pair_id = sessionStore.newDraftPair(agentIds);
    setOpen(false);
    setPicked(new Set());
    void navigate({ to: "/pair/$pairId", params: { pairId: pair_id } });
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("sidebar.pairChat")}
          className={cn(
            "app-no-drag mt-0.5 flex w-full items-center gap-2 rounded-md px-2 text-left text-xs",
            "text-fg hover:bg-bg-surface/60 transition-colors",
          )}
          style={{ height: "var(--row-h)" }}
        >
          <span className="inline-flex size-4 shrink-0 items-center justify-center text-fg-muted">
            <UsersRoundIcon className="size-3.5" />
          </span>
          <span className={labelCls}>{t("sidebar.pairChat")}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <div className="px-2 py-1.5 text-[11px] text-fg-subtle">
          {t("sidebar.pickAgents")}
        </div>
        {enabled.length === 0 ? (
          <div className="px-2 py-2 text-xs text-fg-muted">
            {t("sidebar.noEnabledAgents")}
          </div>
        ) : (
          enabled.map((a) => {
            const isPicked = picked.has(a.id);
            const atCap = !isPicked && picked.size >= 4;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                disabled={atCap}
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs",
                  "hover:bg-bg-surface/60",
                  atCap && "opacity-50",
                )}
              >
                <span
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded border",
                    isPicked
                      ? "border-fg bg-fg text-bg"
                      : "border-border bg-transparent",
                  )}
                >
                  <CheckIcon className={cn("size-3", isPicked ? "opacity-100" : "opacity-0")} />
                </span>
                <span className="flex-1 truncate">{a.label}</span>
                <span className="font-mono text-[10px] text-fg-subtle">
                  {a.id}
                </span>
              </button>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void navigate({ to: "/settings/agents" })}
          className="flex items-center gap-2 text-xs"
        >
          <CpuIcon className="size-3.5" />
          <span>{t("sidebar.manageAgents")}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            start();
          }}
          disabled={picked.size < 2}
          className="justify-center text-xs"
        >
          {t("sidebar.startMultiAgent", { count: picked.size })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
