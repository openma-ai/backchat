import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpFromLineIcon,
  CalendarClockIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  Maximize2Icon,
  MessageSquareIcon,
  Minimize2Icon,
  PlusIcon,
  PuzzleIcon,
  RotateCwIcon,
  SquareTerminalIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { ChatView } from "@/components/chat/ChatView";
import { SubagentAvatar } from "@/components/SubagentAvatar";
import { FileTree } from "@/components/shell/FileTree";
import { BrowserTab } from "@/components/shell/BrowserTab";
import { TerminalTab } from "@/components/shell/TerminalTab";
import { BackgroundProcessTab } from "@/components/shell/BackgroundProcessTab";
import { ArtifactTab } from "@/components/shell/ArtifactTab";
import { ScheduledTaskTab } from "@/components/shell/ScheduledTaskTab";
import { RightPanelLauncher } from "@/components/shell/RightPanelLauncher";
import {
  useRightRailCollapse,
  useRightRailExpansion,
  useSidebarCollapse,
} from "@/components/shell/AppShell";
import { useSettings } from "@/lib/settings-store";
import { browserSettings } from "@shared/browser-settings.js";
import { cn } from "@/lib/utils";
import { previewLocalFile } from "@/lib/file-preview";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  selectActive,
  selectActiveSideTab,
  selectArtifactsFor,
  selectSubagentsFor,
  selectWorkItemsFor,
  selectBrowserWindows,
  selectSideTabs,
  selectTurnsFor,
  sessionStore,
  useSessionStore,
  type SideTab,
  type SideTabType,
  type SubagentActivity,
} from "@/lib/session-store";
import type { AcpTerminalInfo } from "@shared/api.js";
import type { ScheduleInfo } from "@shared/schedules.js";

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
 * label and X close on hover. `+` clears the selection to show the
 * New tab launcher as content; the launcher itself is not a tab.
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
  const artifactsSelector = useMemo(
    () => selectArtifactsFor(mainActive?.id ?? null),
    [mainActive?.id],
  );
  const artifacts = useSessionStore(artifactsSelector);
  const subagentsSelector = useMemo(
    () => selectSubagentsFor(mainActive?.id ?? null),
    [mainActive?.id],
  );
  const subagents = useSessionStore(subagentsSelector);
  const workItemsSelector = useMemo(
    () => selectWorkItemsFor(mainActive?.id ?? null),
    [mainActive?.id],
  );
  const workItems = useSessionStore(workItemsSelector);
  const turnsSelector = useMemo(
    () => selectTurnsFor(mainActive?.id ?? ""),
    [mainActive?.id],
  );
  const taskTurns = useSessionStore(turnsSelector);
  const sourceAttachments = useMemo(
    () => [...new Map(
      taskTurns
        .flatMap((turn) => turn.attachments ?? [])
        .map((attachment) => [attachment.path, attachment]),
    ).values()],
    [taskTurns],
  );
  const processes = useQuery({
    queryKey: ["acp-terminals", mainActive?.id],
    queryFn: () => window.backchat.acpTerminalsList({ sessionId: mainActive!.id }),
    enabled: !!mainActive?.id,
    refetchInterval: 1_500,
  }).data ?? [];
  const schedules = (useQuery({
    queryKey: ["schedules", mainActive?.id],
    queryFn: () => window.backchat.schedulesList(),
    enabled: !!mainActive?.id,
    refetchInterval: 2_000,
  }).data ?? []).filter(
    (schedule) => schedule.sourceSessionId === mainActive?.id,
  );
  const { toggle: toggleRail } = useRightRailCollapse();
  const { collapsed: leftSidebarCollapsed } = useSidebarCollapse();
  const {
    expanded,
    mainSelected,
    setExpanded,
    selectMain,
    selectPanel,
  } = useRightRailExpansion();
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

  const openSubagent = useCallback((activity: SubagentActivity) => {
    if (!mainActive) return;
    const tabId = sessionStore.openSideTabForTask(
      mainActive.id,
      "subagent",
      activity.viewSessionId,
      subagentLabel(activity),
    );
    sessionStore.patchSideTabForTask(mainActive.id, tabId, {
      avatarId: activity.avatarId,
    });
  }, [mainActive]);

  const openProcess = useCallback((process: AcpTerminalInfo) => {
    if (!mainActive) return;
    sessionStore.openSideTabForTask(
      mainActive.id,
      "process",
      process.terminalId,
      processLabel(process),
    );
  }, [mainActive]);

  const openSchedule = useCallback((schedule: ScheduleInfo) => {
    sessionStore.openSideTab("schedule", schedule.id, schedule.name);
  }, []);

  const closeTab = useCallback((tab: SideTab) => {
    // Tear down the underlying resource before removing the tab.
    if (tab.type === "chat") {
      void window.backchat.sessionDispose({ session_id: tab.payload });
    } else if (tab.type === "terminal") {
      void window.backchat.uiTermDispose({ terminalId: tab.payload });
    } else if (tab.source?.kind === "browser-plugin") {
      void window.backchat.browserDetachView({
        browser: tab.source.browserId,
        tabId: tab.source.tabId,
      });
      void window.backchat.browserSetVisibility({
        browser: tab.source.browserId,
        visible: false,
      });
    }
    sessionStore.closeSideTab(tab.id);
  }, []);
  const closeRail = useCallback(() => {
    setExpanded(false);
    toggleRail();
  }, [setExpanded, toggleRail]);

  return (
    <div
      data-expanded-main-selected={expanded && mainSelected}
      className="flex h-full min-h-0 flex-col bg-transparent"
    >
      {/* Header geometry aligned to the fixed top-right toggles via the
          shared --chrome-* tokens. The geometry is covered by the right-panel
          E2E so zoom changes cannot silently separate the three controls. */}
      <div
        data-header-clears-left-chrome={expanded && leftSidebarCollapsed}
        className={cn(
          "app-no-drag pointer-events-auto shrink-0 flex h-[var(--top-row-h)] items-start gap-[var(--chrome-gap)] pl-3 pr-[var(--chrome-gap)]",
          expanded ? "bg-bg-sidebar" : "bg-transparent",
        )}
        style={{
          paddingTop: "calc(var(--chrome-top) - var(--stage-inset))",
          paddingLeft: expanded && leftSidebarCollapsed
            ? "calc(var(--left-chrome-end) + var(--chrome-title-gap) - var(--stage-inset))"
            : undefined,
        }}
      >
        {/* The rail selects one surface at a time. Browser surfaces are
            kept mounted below; other tab types retain their established
            mount/unmount behavior. */}
        <div
          role="tablist"
          aria-label={t("rightPanel.tabs")}
          className="flex min-w-0 flex-1 items-center gap-1"
        >
          {expanded && mainActive && (
            <>
              <button
                type="button"
                role="tab"
                aria-selected={mainSelected}
                data-pinned-main-session="true"
                onClick={selectMain}
                title={mainActive.label}
                className={cn(
                  "inline-flex h-[var(--row-h)] max-w-48 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs",
                  mainSelected
                    ? "liquid-glass-selected text-fg"
                    : "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
                  "transition-colors",
                )}
              >
                <MessageSquareIcon className="size-3.5 shrink-0 text-fg-subtle" />
                <span className="truncate">{mainActive.label}</span>
              </button>
              <span
                aria-hidden="true"
                className="mx-1 h-[var(--row-h)] w-px shrink-0 bg-border"
              />
            </>
          )}
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
                  active={!mainSelected && tab.id === activeTab?.id}
                  onPick={() => {
                    selectPanel();
                    sessionStore.setActiveSideTab(tab.id);
                  }}
                  onClose={() => closeTab(tab)}
                />
              ))}
            </div>
          </div>
        </div>
        <div data-side-tab-actions className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={t("rightPanel.newTab")}
            title={t("rightPanel.newTab")}
            onClick={() => {
              selectPanel();
              sessionStore.setActiveSideTab(null);
            }}
            className="app-no-drag inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-surface/60 hover:text-fg"
          >
            <PlusIcon className="size-3.5" />
          </button>
          {/* Promote-to-main button — only relevant for chat tabs. The
              side chat is a fast scratch surface; once it's worth
              keeping, "promote" lifts it into the sidebar list as a
              real main session (kind flip + route navigate) without
              disposing the ACP child or losing scrollback. */}
          {activeTab?.type === "chat" && (
            <button
              type="button"
              onClick={promoteActive}
              aria-label={t("sideChat.promote")}
              title={t("sideChat.promote")}
              className={cn(
                "app-no-drag inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                "text-fg-subtle hover:bg-bg-surface/60 hover:text-fg",
                "transition-colors",
              )}
            >
              <ArrowUpFromLineIcon className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label={t(expanded ? "sideChat.restoreSplitView" : "sideChat.expandPanel")}
            title={t(expanded ? "sideChat.restoreSplitView" : "sideChat.expandPanel")}
            onClick={() => setExpanded(!expanded)}
            className="app-no-drag inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-surface/60 hover:text-fg"
          >
            {expanded ? (
              <Minimize2Icon className="size-3.5" />
            ) : (
              <Maximize2Icon className="size-3.5" />
            )}
          </button>
          {!expanded && (
            <button
              type="button"
              onClick={closeRail}
              aria-label={t("sideChat.closePanel")}
              title={t("sideChat.closePanel")}
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
          )}
        </div>
      </div>

      <div
        aria-hidden={expanded && mainSelected}
        data-panel-content-hidden={expanded && mainSelected}
        className={cn(
          "relative flex-1 min-h-0",
          expanded && mainSelected && "invisible pointer-events-none",
        )}
      >
        {!activeTab && (
          <EmptyState
            onPick={openTab}
            onPickSubagent={openSubagent}
            onPickProcess={openProcess}
            canStartSideChat={canStartSideChat}
            browserEnabled={browserEnabled}
            artifacts={artifacts}
            subagents={subagents}
            workItems={workItems}
            processes={processes}
            schedules={schedules}
            sourceAttachments={sourceAttachments}
            onOpenSchedule={openSchedule}
          />
        )}
        {activeTab && activeTab.type !== "browser" && (
          <ActiveTabBody
            tab={activeTab}
            schedules={schedules}
            onManageSchedules={() => void navigate({ to: "/scheduled" })}
          />
        )}
        {browserWindows.flatMap((browserWindow) =>
          browserWindow.tabs.map((tab) => {
            const visible =
              (mainActive?.id ?? null) === browserWindow.taskId && activeTab?.id === tab.id;
            if (tab.source?.kind === "browser-plugin") {
              if (!visible) return null;
              return (
                <div key={`${browserWindow.taskId}:${tab.id}`} className="absolute inset-0">
                  <PluginBrowserTab tab={tab} />
                </div>
              );
            }
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

function ActiveTabBody({
  tab,
  schedules,
  onManageSchedules,
}: {
  tab: SideTab;
  schedules: ScheduleInfo[];
  onManageSchedules: () => void;
}) {
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
  if (tab.type === "artifact") {
    return <ArtifactTab key={tab.payload} path={tab.payload} />;
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
  if (tab.type === "process") {
    return <BackgroundProcessTab key={tab.payload} terminalId={tab.payload} />;
  }
  if (tab.type === "schedule") {
    const schedule = schedules.find((candidate) => candidate.id === tab.payload);
    return schedule ? (
      <ScheduledTaskTab schedule={schedule} onManage={onManageSchedules} />
    ) : (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-fg-muted">
        This registered task is no longer available.
      </div>
    );
  }
  if (tab.type === "interactive") {
    return <div id={`interactive-side-host-${tab.payload}`} className="h-full min-h-0" />;
  }
  return null;
}

function PluginBrowserTab({ tab }: { tab: SideTab }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { collapsed } = useRightRailCollapse();
  const source = tab.source?.kind === "browser-plugin" ? tab.source : null;

  const detach = useCallback(() => {
    if (!source) return;
    void window.backchat.browserDetachView({
      browser: source.browserId,
      tabId: source.tabId,
    });
  }, [source]);

  const syncBounds = useCallback(() => {
    if (!source || collapsed) {
      detach();
      return;
    }
    const node = hostRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
    void window.backchat.browserAttachView({
      browser: source.browserId,
      tabId: source.tabId,
      bounds,
      visible: bounds.width > 1 && bounds.height > 1,
    });
  }, [collapsed, detach, source]);

  useLayoutEffect(() => {
    syncBounds();
    const raf = window.requestAnimationFrame(() => syncBounds());
    const settle = window.setTimeout(syncBounds, 320);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [syncBounds]);

  useEffect(() => {
    if (!hostRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncBounds());
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [syncBounds]);

  useEffect(() => detach, [detach]);

  if (!source) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 flex items-center gap-1 px-3 pt-3 pb-2">
        <PluginNavButton
          onClick={() =>
            window.backchat.browserBack({
              browser: source.browserId,
              tabId: source.tabId,
            })
          }
          label="Back"
        >
          <ArrowLeftIcon className="size-3.5" />
        </PluginNavButton>
        <PluginNavButton
          onClick={() =>
            window.backchat.browserForward({
              browser: source.browserId,
              tabId: source.tabId,
            })
          }
          label="Forward"
        >
          <ArrowRightIcon className="size-3.5" />
        </PluginNavButton>
        <PluginNavButton
          onClick={() =>
            window.backchat.browserReload({
              browser: source.browserId,
              tabId: source.tabId,
            })
          }
          label="Reload"
        >
          <RotateCwIcon className="size-3.5" />
        </PluginNavButton>
        <div className="min-w-0 flex-1 truncate rounded-md bg-bg-surface/60 px-2 py-1 text-xs text-fg-muted">
          {tab.payload}
        </div>
      </div>
      <div className="flex-1 min-h-0 px-3 pb-3">
        <div
          ref={hostRef}
          className="h-full w-full overflow-hidden rounded-md bg-bg"
        />
      </div>
    </div>
  );
}

function PluginNavButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
        "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
        "transition-colors",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState(props: React.ComponentProps<typeof RightPanelLauncher>) {
  return <RightPanelLauncher {...props} />;
}

// Kept temporarily as a local fallback for older persisted snapshots. New
// tasks always render RightPanelLauncher above.
function LegacyEmptyState({
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
  const hasArtifacts = artifacts.files.length > 0;

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
      <div className="space-y-2 pt-2">
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
        "group relative inline-flex h-[var(--row-h)] w-32 shrink-0 items-center rounded-md pl-2 pr-1 text-xs select-none",
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
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onPick}
        className={cn(
          "inline-flex min-w-0 flex-1 items-center gap-1.5 truncate",
          active ? "pr-4" : "group-hover:pr-4",
        )}
        title={tab.label}
      >
        {tab.type === "subagent" ? (
          <SubagentAvatar avatarId={tab.avatarId} className="size-[18px]" />
        ) : tab.type === "browser" ? (
          <BrowserTabFavicon tab={tab} active={active} />
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
          "absolute right-1 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded",
          // Always visible on the active tab (so the user can always
          // close it without hovering first); reveal on hover for
          // inactive ones.
          active
            ? "opacity-60"
            : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-60",
          "hover:bg-bg-surface hover:opacity-100",
          "transition-opacity",
        )}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

function BrowserTabFavicon({ tab, active }: { tab: SideTab; active: boolean }) {
  const faviconUrl = tab.faviconUrl;
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [faviconUrl]);

  if (!faviconUrl || !/^data:image\//i.test(faviconUrl) || failed) {
    return (
      <GlobeIcon
        className={cn(
          "size-3.5 shrink-0",
          active ? "text-fg" : "text-fg-subtle",
        )}
      />
    );
  }

  return (
    <img
      src={faviconUrl}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
      className="size-3.5 shrink-0 rounded-[2px] object-contain"
    />
  );
}

const ICON_BY_TYPE: Record<Exclude<SideTabType, "subagent">, LucideIcon> = {
  chat: MessageSquareIcon,
  file: FolderIcon,
  artifact: FileIcon,
  browser: GlobeIcon,
  terminal: SquareTerminalIcon,
  process: SquareTerminalIcon,
  schedule: CalendarClockIcon,
  interactive: PuzzleIcon,
};

function subagentLabel(activity: SubagentActivity): string {
  return activity.native?.nickname || activity.task || activity.native?.agentType || activity.childSessionId;
}

function processLabel(process: AcpTerminalInfo): string {
  return [process.command, ...process.args].join(" ") || process.terminalId;
}

function deriveBrowserLabel(url: string): string {
  if (url === "about:blank") return "New tab";
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
