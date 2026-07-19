import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpFromLineIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  MessageSquareIcon,
  PlusIcon,
  PuzzleIcon,
  SquareTerminalIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { ChatView } from "@/components/chat/ChatView";
import { SubagentAvatar } from "@/components/SubagentAvatar";
import { FileTree } from "@/components/shell/FileTree";
import { BrowserTab } from "@/components/shell/BrowserTab";
import { TerminalTab } from "@/components/shell/TerminalTab";
import { useRightRailCollapse } from "@/components/shell/AppShell";
import { useSettings } from "@/lib/settings-store";
import { browserSettings } from "@shared/browser-settings.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { previewLocalFile } from "@/lib/file-preview";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  selectActive,
  selectActiveSideTab,
  selectArtifactsFor,
  selectBrowserWindows,
  selectSideTabs,
  sessionStore,
  useSessionStore,
  type SideTab,
  type SideTabType,
} from "@/lib/session-store";

/**
 * SideChatPanel — Codex-style right rail. Multi-tab; each tab is one
 * of five types:
 *
 *   chat       → side ACP session subordinate to the active main
 *                thread. It uses ACP session/fork when available for
 *                context inheritance, and can be promoted into an
 *                independent main fork.
 *   subagent   → native provider-created subagent activity. The GUI
 *                does not create these; CC/Codex events surface them.
 *   file       → cwd file tree. Payload is the absolute cwd path.
 *   browser    → Electron <webview>. Payload is the current URL.
 *   terminal   → pty shell (same UiTerm broker as the bottom panel).
 *                Payload is the terminalId (pre-spawned).
 *   interactive → portal target for MCP Apps and inline visualizations.
 *
 * The tab bar mirrors BottomPanel's: chip with icon + truncated
 * label, X close on hover, `+` opens a popover to pick the type.
 *
 * Toggle position: the rail's collapse toggle sits at the viewport
 * top-right when collapsed (only way to re-open) and inside the
 * panel's header when expanded (matches image #13). The expanded-state
 * toggle is rendered HERE inside the header so it lives next to the
 * tab bar instead of floating over the stage.
 */
export function SideChatPanel() {
  const { t } = useI18n();
  const tabs = useSessionStore(selectSideTabs);
  const activeTab = useSessionStore(selectActiveSideTab);
  const browserWindows = useSessionStore(selectBrowserWindows);
  const mainActive = useSessionStore(selectActive);
  const settings = useSettings();
  const browserEnabled = browserSettings(settings?.browser).enabled;
  const { toggle: toggleRail } = useRightRailCollapse();
  const navigate = useNavigate();
  const canStartSideChat = !!mainActive && mainActive.status !== "draft";
  const canForkSideChat =
    canStartSideChat && !!mainActive?.supportsSessionFork && !!mainActive?.acp_session_id;
  const restoringTerminals = useRef(new Set<string>());
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const [tabScrollFade, setTabScrollFade] = useState({
    left: false,
    right: false,
  });

  const updateTabScrollFade = useCallback(() => {
    const scroll = tabScrollRef.current;
    if (!scroll) return;
    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const next = {
      left: scroll.scrollLeft > 1,
      right: scroll.scrollLeft < maxScrollLeft - 1,
    };
    setTabScrollFade((current) =>
      current.left === next.left && current.right === next.right
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    const scroll = tabScrollRef.current;
    if (!scroll) return;
    updateTabScrollFade();
    const observer = new ResizeObserver(updateTabScrollFade);
    observer.observe(scroll);
    const strip = scroll.firstElementChild;
    if (strip instanceof HTMLElement) observer.observe(strip);
    return () => observer.disconnect();
  }, [tabs.length, updateTabScrollFade]);

  // PTY ids are process-local and cannot survive an app restart. A restored
  // terminal tab carries only its cwd; recreate the shell lazily when its
  // owning task's rail mounts, then swap in the fresh runtime id in place.
  useEffect(() => {
    const taskId = mainActive?.id;
    if (!taskId) return;
    for (const tab of tabs) {
      if (tab.type !== "terminal" || !tab.needsRestore) continue;
      if (restoringTerminals.current.has(tab.id)) continue;
      restoringTerminals.current.add(tab.id);
      void window.backchat.uiTermSpawn({
        cwd: tab.terminalCwd || mainActive.cwd || undefined,
        cols: 80,
        rows: 24,
      }).then(({ terminalId }) => {
        sessionStore.patchSideTabForTask(taskId, tab.id, {
          payload: terminalId,
          needsRestore: false,
        });
      }).catch((error) => {
        console.warn("Failed to restore side terminal", error);
      }).finally(() => {
        restoringTerminals.current.delete(tab.id);
      });
    }
  }, [mainActive?.cwd, mainActive?.id, tabs]);

  useEffect(() => window.backchat.onBrowserToolTabCommand((command) => {
    if (!browserEnabled) return;
    if (command.action === "open") {
      sessionStore.openSideTabForTask(
        command.sessionId,
        "browser",
        command.url,
        undefined,
        command.tabId,
      );
      return;
    }
    if (command.action === "activate") {
      sessionStore.setActiveSideTabForTask(command.sessionId, command.tabId);
      return;
    }
    sessionStore.closeSideTabForTask(command.sessionId, command.tabId);
  }), [browserEnabled]);

  const promoteActive = useCallback(() => {
    if (!activeTab || activeTab.type !== "chat") return;
    const sid = sessionStore.promoteSideToMain(activeTab.payload);
    if (!sid) return;
    void navigate({ to: "/chat/$sessionId", params: { sessionId: sid } });
  }, [activeTab, navigate]);

  const openSideChat = useCallback(
    async () => {
      if (!mainActive || !canStartSideChat) return;
      const cwd =
        mainActive.cwd ||
        (await window.backchat.uiFsHome());
      const inheritance = canForkSideChat ? "fork" : "fresh";
      const sid = sessionStore.newSideDraft({
        parentSessionId: mainActive.id,
        parentAcpSessionId: canForkSideChat ? mainActive.acp_session_id : undefined,
        inheritance,
        agentId: mainActive.agent_id,
        cwd,
      });
      sessionStore.openSideTab("chat", sid, t("sideChat.title"));
    },
    [
      canForkSideChat,
      canStartSideChat,
      mainActive,
      t,
    ],
  );

  const openTab = useCallback(
    async (type: SideTabType) => {
      if (type === "browser" && !browserEnabled) return;
      // Side tools belong to the active task workspace. Home is used only
      // when there is no active task.
      const cwd =
        mainActive?.cwd ||
        (await window.backchat.uiFsHome());
      if (type === "chat") {
        await openSideChat();
      } else if (type === "file") {
        sessionStore.openSideTab("file", cwd, undefined);
      } else if (type === "browser") {
        sessionStore.openSideTab(
          "browser",
          "about:blank",
          undefined,
        );
      } else if (type === "terminal") {
        // Pre-spawn the pty so the tab payload has a real terminalId.
        const { terminalId } = await window.backchat.uiTermSpawn({
          cwd,
          cols: 80,
          rows: 24,
        });
        const tabId = sessionStore.openSideTab(
          "terminal",
          terminalId,
          deriveFileLabel(cwd),
        );
        sessionStore.patchSideTab(tabId, {
          terminalCwd: cwd,
          needsRestore: false,
        });
      }
    },
    [browserEnabled, mainActive?.cwd, openSideChat],
  );

  const closeTab = useCallback((tab: SideTab) => {
    // Tear down the underlying resource before removing the tab.
    if (tab.type === "chat") {
      void window.backchat.sessionDispose({ session_id: tab.payload });
    } else if (tab.type === "terminal") {
      void window.backchat.uiTermDispose({ terminalId: tab.payload });
    }
    sessionStore.closeSideTab(tab.id);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      {/* Header geometry aligned to the fixed top-right toggles via the
          shared --chrome-* tokens:
            stage-inset (6) + border (1) + pt-1.5 (6) + size-6/2 (12) = 25
          which equals chrome-top (13) + chrome-size/2 (12) = 25.
          px-3 (12) + border (1) = 13 ≈ chrome-gap (16) on the inside
          edge — close enough that the in-panel button and the fixed
          terminal toggle outside read as mirrored across the seam. */}
      <div className="shrink-0 flex items-center gap-[var(--chrome-gap)] bg-transparent pl-3 pr-[var(--chrome-gap)] pt-1.5 pb-2">
        {/* Collapse rail button — image #13: lives inside the panel's
            top-left when expanded. Mirrors the left sidebar toggle's
            position + icon family. */}
        <button
          type="button"
          onClick={toggleRail}
          aria-label="Close side panel"
          title="Close side panel"
          className={cn(
            "app-no-drag relative z-20 inline-flex size-6 shrink-0 items-center justify-center rounded-md",
            "text-fg-subtle hover:bg-bg-surface/60 hover:text-fg",
            "transition-colors",
          )}
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <line x1="10" y1="3" x2="10" y2="13" />
          </svg>
        </button>

        {/* The rail selects one surface at a time. Browser surfaces are
            kept mounted below; other tab types retain their established
            mount/unmount behavior. */}
        <div className="-ml-3 flex min-w-0 flex-1 items-start gap-1 pl-3">
          <div
            ref={tabScrollRef}
            data-side-tab-scroll
            data-fade-left={tabScrollFade.left}
            data-fade-right={tabScrollFade.right}
            onScroll={updateTabScrollFade}
            className="side-tab-scroll min-w-0 flex-1 overflow-x-auto"
          >
            <div className="flex w-max items-center gap-1">
              {tabs.map((tab) => (
                <TabChip
                  key={tab.id}
                  tab={tab}
                  active={tab.id === activeTab?.id}
                  onPick={() => sessionStore.setActiveSideTab(tab.id)}
                  onClose={() => closeTab(tab)}
                />
              ))}
            </div>
          </div>
          <div data-side-tab-actions className="flex shrink-0 items-center gap-1">
            <AddTabButton
              onPick={openTab}
              browserEnabled={browserEnabled}
            />
            {/* Promote-to-main button — only relevant for chat tabs. The
              side chat is a fast scratch surface; once it's worth
              keeping, "promote" lifts it into the sidebar list as a
              real main session (kind flip + route navigate) without
              disposing the ACP child or losing scrollback. */}
            {activeTab?.type === "chat" && (
              <button
                type="button"
                onClick={promoteActive}
                aria-label="Promote to main chat"
                title="Promote to main chat"
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                  "text-fg-subtle hover:bg-bg-surface/60 hover:text-fg",
                  "transition-colors",
                )}
              >
                <ArrowUpFromLineIcon className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        {!activeTab && (
          <EmptyState
            onPick={openTab}
            canStartSideChat={canStartSideChat}
            browserEnabled={browserEnabled}
          />
        )}
        {activeTab && activeTab.type !== "browser" && (
          <ActiveTabBody tab={activeTab} />
        )}
        {browserWindows.flatMap((browserWindow) =>
          browserWindow.tabs.map((tab) => {
            const visible =
              (mainActive?.id ?? null) === browserWindow.taskId && activeTab?.id === tab.id;
            return (
              <div
                key={`${browserWindow.taskId}:${tab.id}`}
                aria-hidden={!visible}
                className={cn(
                  "absolute inset-0",
                  visible ? "visible pointer-events-auto" : "invisible pointer-events-none",
                )}
              >
                <BrowserTab
                  sessionId={browserWindow.taskId}
                  tabId={tab.id}
                  active={browserWindow.activeTabId === tab.id}
                  visible={visible}
                  initialUrl={tab.payload}
                  sourcePath={tab.sourcePath}
                  onUrlChange={(url) =>
                    sessionStore.patchSideTabForTask(browserWindow.taskId, tab.id, {
                      payload: url,
                      label: deriveBrowserLabel(url),
                      faviconUrl: undefined,
                    })
                  }
                  onPageMeta={({ title, faviconUrl }) =>
                    sessionStore.patchSideTabForTask(browserWindow.taskId, tab.id, {
                      ...(title ? { label: title } : {}),
                      ...(faviconUrl ? { faviconUrl } : {}),
                    })
                  }
                />
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

function ActiveTabBody({ tab }: { tab: SideTab }) {
  // Switch on tab.type. Each branch is a discrete component. The key
  // prop on the ChatView (for chat tabs) makes React unmount + remount
  // on tab swap so the streaming-markdown channel re-attaches to the
  // right session.
  if (tab.type === "chat" || tab.type === "subagent") {
    return <ChatView key={tab.payload} mode="side" />;
  }
  if (tab.type === "file") {
    return (
      <FileTree
        key={tab.payload}
        rootPath={tab.payload}
        onOpenFile={(path) => void previewLocalFile(path)}
        onRootChange={(next) =>
          sessionStore.patchSideTab(tab.id, {
            payload: next,
            label: deriveFileLabel(next),
          })
        }
      />
    );
  }
  if (tab.type === "terminal") {
    if (tab.needsRestore || !tab.payload) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-fg-muted">
          Restoring terminal…
        </div>
      );
    }
    return (
      <div className="h-full px-3 pb-3">
        <TerminalTab key={tab.payload} terminalId={tab.payload} />
      </div>
    );
  }
  if (tab.type === "interactive") {
    return <div id={`interactive-side-host-${tab.payload}`} className="h-full min-h-0" />;
  }
  return null;
}

function EmptyState({
  onPick,
  canStartSideChat,
  browserEnabled,
}: {
  onPick: (type: SideTabType) => void;
  canStartSideChat: boolean;
  browserEnabled: boolean;
}) {
  // 推荐 ordering:
  //   1. Services the agent has spun up in THIS chat (localhost URLs
  //      sniffed from tool_call output). Most relevant — user just
  //      asked for them.
  //   2. Files the agent has touched in THIS chat.
  //   3. Fallback: recent files in the workspace cwd by mtime.
  // Cwd resolution mirrors openTab's:
  //   main session.cwd → $HOME.
  const mainActive = useSessionStore(selectActive);
  const artifactsSelector = useMemo(
    () => selectArtifactsFor(mainActive?.id ?? null),
    [mainActive?.id],
  );
  const artifacts = useSessionStore(artifactsSelector);
  const hasArtifacts =
    artifacts.files.length > 0 || (browserEnabled && artifacts.services.length > 0);

  const [recent, setRecent] = useState<
    { name: string; path: string; isDir: boolean; mtime: number }[]
  >([]);
  const [cwd, setCwd] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const next =
        mainActive?.cwd ||
        (await window.backchat.uiFsHome());
      if (cancelled) return;
      setCwd(next);
      // Only fetch cwd recents if there are no agent-touched artifacts —
      // those win the recommendation slot when present.
      if (hasArtifacts) {
        setRecent([]);
        return;
      }
      try {
        const rows = await window.backchat.uiFsRecent({ path: next, limit: 8 });
        if (!cancelled) setRecent(rows);
      } catch {
        if (!cancelled) setRecent([]);
      }
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [mainActive?.cwd, hasArtifacts]);

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <div className="grid grid-cols-2 auto-rows-fr gap-3 pt-2">
        {EMPTY_TILES.filter((tile) => browserEnabled || tile.type !== "browser").map((tile) => {
          const disabled = tile.type === "chat" && !canStartSideChat;
          return (
            <QuickTile
              key={tile.type}
              tile={tile}
              disabled={disabled}
              onClick={() => onPick(tile.type)}
            />
          );
        })}
      </div>

      {browserEnabled && artifacts.services.length > 0 && (
        <section className="mt-6">
          <div className="mb-2 text-xs font-medium text-fg select-none">正在跑的服务</div>
          <ul className="space-y-1">
            {artifacts.services.slice(0, 6).map((url) => (
              <li key={url}>
                <RecentRow
                  label={shortenServiceUrl(url)}
                  hint={url}
                  icon={<GlobeIcon className="size-4 text-fg-subtle" />}
                  onClick={() => {
                    // Open a browser tab anchored on this dev server.
                    sessionStore.openSideTab("browser", url, undefined);
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {artifacts.files.length > 0 && (
        <section className="mt-6">
          <div className="mb-2 text-xs font-medium text-fg select-none">最近改动的文件</div>
          <ul className="space-y-1">
            {artifacts.files.slice(0, 8).map((path) => (
              <li key={path}>
                <RecentRow
                  label={basename(path)}
                  hint={path}
                  icon={<FileIcon className="size-4 text-fg-subtle" />}
                  onClick={() => {
                    void previewLocalFile(path);
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!hasArtifacts && recent.length > 0 && (
        <section className="mt-6">
          <div className="mb-2 flex items-baseline justify-between select-none">
            <span className="text-xs font-medium text-fg">推荐</span>
            <span
              className="font-mono text-[10px] text-fg-subtle truncate max-w-[60%]"
              title={cwd}
            >
              {shortPathTail(cwd)}
            </span>
          </div>
          <ul className="space-y-1">
            {recent.map((entry) => (
              <li key={entry.path}>
                <RecentRow
                  label={entry.name}
                  hint={entry.isDir ? "目录" : "文件"}
                  icon={
                    entry.isDir ? (
                      <FolderIcon className="size-4 text-fg-subtle" />
                    ) : (
                      <FileIcon className="size-4 text-fg-subtle" />
                    )
                  }
                  onClick={() => {
                    if (entry.isDir) {
                      sessionStore.openSideTab("file", entry.path, entry.name);
                    } else {
                      void previewLocalFile(entry.path);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function shortPathTail(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\/+$/, "").split("/");
  if (parts.length <= 2) return p;
  return ".../" + parts.slice(-2).join("/");
}

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const last = trimmed.split("/").pop();
  return last || p;
}

function shortenServiceUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.host + (url.pathname === "/" ? "" : url.pathname);
  } catch {
    return u;
  }
}

interface QuickTileSpec {
  type: SideTabType;
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
  icon: LucideIcon;
  shortcut?: string;
}

const EMPTY_TILES: QuickTileSpec[] = [
  { type: "file", titleKey: "sideChat.file", subtitleKey: "sideChat.fileHint", icon: FolderIcon, shortcut: "⌘P" },
  { type: "chat", titleKey: "sideChat.title", subtitleKey: "sideChat.forkHint", icon: MessageSquareIcon },
  { type: "browser", titleKey: "sideChat.browser", subtitleKey: "sideChat.browserHint", icon: GlobeIcon, shortcut: "⌘T" },
  { type: "terminal", titleKey: "sideChat.terminal", subtitleKey: "sideChat.terminalHint", icon: SquareTerminalIcon, shortcut: "⌃`" },
];

function QuickTile({
  tile,
  disabled,
  onClick,
}: {
  tile: QuickTileSpec;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const Icon = tile.icon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      // select-none: a stray click on the tile label otherwise registers
      // as native text selection (image #24). Tiles are pure UI, nothing
      // to copy here.
      className={cn(
        "select-none",
        // Three-stack layout: icon+title+subtitle at top, chip-or-spacer
        // at bottom. The chip slot is ALWAYS rendered (h-5 spacer when no
        // shortcut) so every tile in the grid is exactly the same height.
        "flex h-full flex-col items-center justify-between gap-2 rounded-xl px-4 py-6",
        "bg-bg-surface/60 text-fg hover:bg-bg-surface",
        "transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-bg-surface/60",
        "min-h-[140px]",
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <Icon className="size-6 text-fg-subtle" />
        <div className="text-center">
          <div className="text-sm font-medium">{t(tile.titleKey)}</div>
          <div className="mt-0.5 text-[11px] text-fg-muted">{t(tile.subtitleKey)}</div>
        </div>
      </div>
      {tile.shortcut ? (
        <kbd
          className={cn(
            "inline-flex h-5 items-center rounded-md px-1.5",
            "bg-bg-surface text-[10px] font-mono text-fg-muted",
            "border border-border/60",
          )}
        >
          {tile.shortcut}
        </kbd>
      ) : (
        <span aria-hidden="true" className="h-5" />
      )}
    </button>
  );
}

function RecentRow({
  label,
  hint,
  icon,
  onClick,
}: {
  label: string;
  hint: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left select-none",
        "hover:bg-bg-surface/60 transition-colors",
      )}
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-surface/60">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{label}</div>
        <div className="truncate text-[11px] text-fg-subtle">{hint}</div>
      </div>
    </button>
  );
}

function TabChip({
  tab,
  active,
  onPick,
  onClose,
}: {
  tab: SideTab;
  active: boolean;
  onPick: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const Icon = tab.type === "subagent" ? null : ICON_BY_TYPE[tab.type];
  return (
    <div
      className={cn(
        "group inline-flex shrink-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-xs select-none",
        // Active tab: filled surface + crisp text + subtle inset
        // border so the chip reads as "lifted" from the bar even on
        // first glance. Inactive: transparent until hover, with the
        // foreground color still visible enough to be a click target
        // (image #95 — every tab read as inactive because the
        // bg-bg-surface/60 hover landed too close to the bg-bg-surface
        // active background).
        active
          ? "liquid-glass-selected text-fg"
          : "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
        "transition-colors",
      )}
      style={{ height: "26px" }}
    >
      <button
        type="button"
        onClick={onPick}
        className="inline-flex items-center gap-1.5 truncate max-w-[160px]"
        title={tab.label}
      >
        {tab.type === "subagent" ? (
          <SubagentAvatar avatarId={tab.avatarId} className="size-[18px]" />
        ) : Icon ? (
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              active ? "text-fg" : "text-fg-subtle",
            )}
          />
        ) : null}
        {/* min-w-0 so the truncate inside the flex actually engages,
            and the label always shows even when narrow — image #95
            had chat/browser tabs reading as icon-only because the
            truncate had no room. */}
        <span className="min-w-0 truncate">{tab.label}</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("sideChat.closeTab")}
        className={cn(
          "inline-flex size-4 items-center justify-center rounded",
          // Always visible on the active tab (so the user can always
          // close it without hovering first); reveal on hover for
          // inactive ones.
          active ? "opacity-60" : "opacity-0 group-hover:opacity-60",
          "hover:bg-bg-surface hover:opacity-100",
          "transition-opacity",
        )}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

function AddTabButton({
  onPick,
  browserEnabled,
}: {
  onPick: (type: SideTabType) => void;
  browserEnabled: boolean;
}) {
  const { t } = useI18n();
  // Radix DropdownMenu — uses a Portal so the popover content escapes
  // any overflow-hidden ancestor (the side panel `<aside>` is one),
  // and handles click-outside + focus return for us. Replaced a
  // hand-rolled state + fixed catcher that fought stacking contexts.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("sideChat.newTab")}
          title={t("sideChat.newTab")}
            className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
            "text-fg-subtle hover:bg-bg-surface/60 hover:text-fg",
            "transition-colors",
          )}
        >
          <PlusIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        className="min-w-[180px]"
      >
        {POPOVER_ITEMS.filter((item) => browserEnabled || item.type !== "browser").map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.type}
              onSelect={() => onPick(item.type)}
              className="flex items-center gap-2 text-xs"
            >
              <Icon className="size-3.5 text-fg-subtle" />
              <span className="flex-1">{t(item.labelKey)}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ICON_BY_TYPE: Record<Exclude<SideTabType, "subagent">, LucideIcon> = {
  chat: MessageSquareIcon,
  file: FolderIcon,
  browser: GlobeIcon,
  terminal: SquareTerminalIcon,
  interactive: PuzzleIcon,
};

const POPOVER_ITEMS: { type: SideTabType; labelKey: TranslationKey; icon: LucideIcon }[] = [
  { type: "file", labelKey: "sideChat.file", icon: FolderIcon },
  { type: "chat", labelKey: "sideChat.title", icon: MessageSquareIcon },
  { type: "browser", labelKey: "sideChat.browser", icon: GlobeIcon },
  { type: "terminal", labelKey: "sideChat.terminal", icon: SquareTerminalIcon },
];

function deriveBrowserLabel(url: string): string {
  if (url === "about:blank") return "New tab";
  try {
    return new URL(url).hostname;
  } catch {
    return "Browser";
  }
}

function faviconFallback(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

function deriveFileLabel(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const last = trimmed.split("/").pop();
  return last || "Files";
}
