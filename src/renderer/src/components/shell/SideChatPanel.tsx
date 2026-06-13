import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpFromLineIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  MessageSquareIcon,
  PlusIcon,
  SquareTerminalIcon,
  XIcon,
} from "lucide-react";
import { ChatView } from "@/components/chat/ChatView";
import { FileTree } from "@/components/shell/FileTree";
import { BrowserTab } from "@/components/shell/BrowserTab";
import { TerminalTab } from "@/components/shell/TerminalTab";
import { useRightRailCollapse } from "@/components/shell/AppShell";
import { useSettings } from "@/lib/settings-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  selectActive,
  selectActiveSideTab,
  selectArtifactsFor,
  selectSideTabs,
  sessionStore,
  useSessionStore,
  type SideTab,
  type SideTabType,
} from "@/lib/session-store";

/**
 * SideChatPanel — Codex-style right rail. Multi-tab; each tab is one
 * of four types:
 *
 *   chat       → side ACP session (independent from main thread).
 *                Backed by a SessionRow (kind:"side"); tab payload
 *                holds the session id.
 *   file       → cwd file tree. Payload is the absolute cwd path.
 *   browser    → Electron <webview>. Payload is the current URL.
 *   terminal   → pty shell (same UiTerm broker as the bottom panel).
 *                Payload is the terminalId (pre-spawned).
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
  const tabs = useSessionStore(selectSideTabs);
  const activeTab = useSessionStore(selectActiveSideTab);
  const mainActive = useSessionStore(selectActive);
  const settings = useSettings();
  const { toggle: toggleRail } = useRightRailCollapse();
  const navigate = useNavigate();

  const promoteActive = useCallback(() => {
    if (!activeTab || activeTab.type !== "chat") return;
    const sid = sessionStore.promoteSideToMain(activeTab.payload);
    if (!sid) return;
    void navigate({ to: "/chat/$sessionId", params: { sessionId: sid } });
  }, [activeTab, navigate]);

  const openTab = useCallback(
    async (type: SideTabType) => {
      // Resolve cwd for file / terminal tabs in this order:
      //   1. settings.default.workspace_path — user preference if set.
      //   2. active main session's cwd — this is now ALWAYS a real
      //      path (ChatView's session start picks workspace_path or
      //      $HOME upstream, never the old sandbox path).
      //   3. $HOME — boring fallback when no chat is active.
      const settingsCwd = settings?.default.workspace_path?.trim() || "";
      const cwd =
        settingsCwd ||
        mainActive?.cwd ||
        (await window.backchat.uiFsHome());
      if (type === "chat") {
        const sid = sessionStore.newSideDraft();
        sessionStore.openSideTab("chat", sid, "New chat");
      } else if (type === "file") {
        sessionStore.openSideTab("file", cwd, undefined);
      } else if (type === "browser") {
        sessionStore.openSideTab(
          "browser",
          "https://www.google.com",
          undefined,
        );
      } else if (type === "terminal") {
        // Pre-spawn the pty so the tab payload has a real terminalId.
        const { terminalId } = await window.backchat.uiTermSpawn({
          cwd,
          cols: 80,
          rows: 24,
        });
        sessionStore.openSideTab("terminal", terminalId, undefined);
      }
    },
    [mainActive?.cwd, settings?.default.workspace_path],
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
    <div className="flex h-full min-h-0 flex-col">
      {/* Header geometry aligned to the fixed top-right toggles via the
          shared --chrome-* tokens:
            stage-inset (6) + border (1) + pt-1.5 (6) + size-6/2 (12) = 25
          which equals chrome-top (13) + chrome-size/2 (12) = 25.
          px-3 (12) + border (1) = 13 ≈ chrome-gap (16) on the inside
          edge — close enough that the in-panel button and the fixed
          terminal toggle outside read as mirrored across the seam. */}
      <div className="shrink-0 flex items-center gap-[var(--chrome-gap)] pl-[var(--chrome-gap)] pr-[var(--chrome-gap)] pt-1.5 pb-2">
        {/* Collapse rail button — image #13: lives inside the panel's
            top-left when expanded. Mirrors the left sidebar toggle's
            position + icon family. */}
        <button
          type="button"
          onClick={toggleRail}
          aria-label="Close side panel"
          title="Close side panel"
          className={cn(
            "app-no-drag inline-flex size-6 shrink-0 items-center justify-center rounded-md",
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

        {/* Tab chips. Single-active model — only the active tab's body
            is mounted; switching unmounts the prior body and remounts
            the next (state lives in sessionStore so chat scrollback
            replays on re-mount via StreamingMarkdown's reattach). */}
        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <TabChip
              key={t.id}
              tab={t}
              active={t.id === activeTab?.id}
              onPick={() => sessionStore.setActiveSideTab(t.id)}
              onClose={() => closeTab(t)}
            />
          ))}
          <AddTabButton onPick={openTab} />
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

      <div className="flex-1 min-h-0">
        {!activeTab ? (
          <EmptyState onPick={openTab} />
        ) : (
          <ActiveTabBody tab={activeTab} />
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
  if (tab.type === "chat") {
    return <ChatView key={tab.payload} mode="side" />;
  }
  if (tab.type === "file") {
    return (
      <FileTree
        key={tab.payload}
        rootPath={tab.payload}
        onRootChange={(next) =>
          sessionStore.patchSideTab(tab.id, {
            payload: next,
            label: deriveFileLabel(next),
          })
        }
      />
    );
  }
  if (tab.type === "browser") {
    return (
      <BrowserTab
        key={tab.id}
        initialUrl={tab.payload}
        onUrlChange={(url) =>
          sessionStore.patchSideTab(tab.id, {
            payload: url,
            label: deriveBrowserLabel(url),
          })
        }
      />
    );
  }
  if (tab.type === "terminal") {
    return (
      <div className="h-full px-3 pb-3">
        <TerminalTab key={tab.payload} terminalId={tab.payload} />
      </div>
    );
  }
  return null;
}

function EmptyState({ onPick }: { onPick: (type: SideTabType) => void }) {
  // 推荐 ordering:
  //   1. Services the agent has spun up in THIS chat (localhost URLs
  //      sniffed from tool_call output). Most relevant — user just
  //      asked for them.
  //   2. Files the agent has touched in THIS chat.
  //   3. Fallback: recent files in the workspace cwd by mtime.
  // Cwd resolution mirrors openTab's:
  //   settings.workspace_path → main session.cwd → $HOME.
  const mainActive = useSessionStore(selectActive);
  const settings = useSettings();
  const artifactsSelector = useMemo(
    () => selectArtifactsFor(mainActive?.id ?? null),
    [mainActive?.id],
  );
  const artifacts = useSessionStore(artifactsSelector);
  const hasArtifacts =
    artifacts.files.length > 0 || artifacts.services.length > 0;

  const [recent, setRecent] = useState<
    { name: string; path: string; isDir: boolean; mtime: number }[]
  >([]);
  const [cwd, setCwd] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const settingsCwd = settings?.default.workspace_path?.trim() || "";
    const resolve = async () => {
      const next =
        settingsCwd ||
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
  }, [mainActive?.cwd, settings?.default.workspace_path, hasArtifacts]);

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <div className="grid grid-cols-2 auto-rows-fr gap-3 pt-2">
        {EMPTY_TILES.map((tile) => (
          <QuickTile key={tile.type} tile={tile} onClick={() => onPick(tile.type)} />
        ))}
      </div>

      {artifacts.services.length > 0 && (
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
                    openArtifactFile(path);
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
                      openArtifactFile(entry.path);
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

/** Open an artifact file the right way for its type. HTML/HTM goes
 *  into the sidebar BrowserTab so the user previews it inside the
 *  app — matches the auto-open behavior in session-store.#autoOpenHtml
 *  and the markdown link click handler. Everything else (images,
 *  pdfs, source files) goes through uiFsOpenPath → OS default app,
 *  because the embedded webview isn't a great viewer for those and
 *  the system app usually is. */
function openArtifactFile(path: string): void {
  if (/\.html?$/i.test(path)) {
    sessionStore.openSideTab("browser", "file://" + path, basename(path));
    return;
  }
  void window.backchat.uiFsOpenPath({ path });
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
  title: string;
  subtitle: string;
  icon: typeof FolderIcon;
  shortcut?: string;
}

const EMPTY_TILES: QuickTileSpec[] = [
  { type: "file", title: "文件", subtitle: "浏览项目文件", icon: FolderIcon, shortcut: "⌘P" },
  { type: "chat", title: "侧边聊天", subtitle: "发起侧边对话", icon: MessageSquareIcon },
  { type: "browser", title: "浏览器", subtitle: "打开网站", icon: GlobeIcon, shortcut: "⌘T" },
  { type: "terminal", title: "终端", subtitle: "启动交互式 shell", icon: SquareTerminalIcon, shortcut: "⌃`" },
];

function QuickTile({
  tile,
  onClick,
}: {
  tile: QuickTileSpec;
  onClick: () => void;
}) {
  const Icon = tile.icon;
  return (
    <button
      type="button"
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
        "min-h-[140px]",
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <Icon className="size-6 text-fg-subtle" />
        <div className="text-center">
          <div className="text-sm font-medium">{tile.title}</div>
          <div className="mt-0.5 text-[11px] text-fg-muted">{tile.subtitle}</div>
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
  const Icon = ICON_BY_TYPE[tab.type];
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
          ? "bg-bg text-fg shadow-[inset_0_0_0_1px_var(--border)]"
          : "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
        "transition-colors",
      )}
      style={{ height: "26px" }}
    >
      <button
        type="button"
        onClick={onPick}
        className="inline-flex items-center gap-1.5 truncate max-w-[140px]"
        title={tab.label}
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            active ? "text-fg" : "text-fg-subtle",
          )}
        />
        {/* min-w-0 so the truncate inside the flex actually engages,
            and the label always shows even when narrow — image #95
            had chat/browser tabs reading as icon-only because the
            truncate had no room. */}
        <span className="min-w-0 truncate">{tab.label}</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close tab"
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

function AddTabButton({ onPick }: { onPick: (type: SideTabType) => void }) {
  // Radix DropdownMenu — uses a Portal so the popover content escapes
  // any overflow-hidden ancestor (the side panel `<aside>` is one),
  // and handles click-outside + focus return for us. Replaced a
  // hand-rolled state + fixed catcher that fought stacking contexts.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="New tab"
          title="New tab"
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
        {POPOVER_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.type}
              onSelect={() => onPick(item.type)}
              className="flex items-center gap-2 text-xs"
            >
              <Icon className="size-3.5 text-fg-subtle" />
              <span className="flex-1">{item.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ICON_BY_TYPE: Record<SideTabType, typeof MessageSquareIcon> = {
  chat: MessageSquareIcon,
  file: FolderIcon,
  browser: GlobeIcon,
  terminal: SquareTerminalIcon,
};

// Order matches image #14: 文件 / 侧边聊天 / 浏览器 / 终端.
const POPOVER_ITEMS: { type: SideTabType; label: string; icon: typeof FolderIcon }[] = [
  { type: "file", label: "文件", icon: FolderIcon },
  { type: "chat", label: "侧边聊天", icon: MessageSquareIcon },
  { type: "browser", label: "浏览器", icon: GlobeIcon },
  { type: "terminal", label: "终端", icon: SquareTerminalIcon },
];

function deriveBrowserLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "Browser";
  }
}

function deriveFileLabel(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const last = trimmed.split("/").pop();
  return last || "Files";
}
