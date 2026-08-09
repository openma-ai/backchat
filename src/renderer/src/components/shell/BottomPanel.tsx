import { useCallback, useEffect, useState } from "react";
import { PlusIcon, SquareTerminalIcon, XIcon } from "lucide-react";
import { useBottomBarCollapse } from "@/components/shell/AppShell";
import { TerminalTab } from "@/components/shell/TerminalTab";
import { cn } from "@/lib/utils";
import { selectActive, useSessionStore } from "@/lib/session-store";
import { useTheme } from "@/lib/theme";

/**
 * BottomPanel — full-width footer hosting one or more pty-backed
 * terminal tabs. The "tab" model matches Codex: each `+` spawns a new
 * shell in the active session's cwd; `X` closes one (disposes the
 * pty); only the focused tab's xterm.js is rendered live (others stay
 * mounted but display:none so they keep scrollback).
 *
 * Mount is gated by the BottomBarCollapseContext — when collapsed, the
 * <footer> doesn't render at all so xterm.js terminals don't even hold
 * a webgl context. Re-expanding remounts the active tab, which means
 * its existing pty's scrollback is replayed (node-pty buffers the last
 * N lines in main; the renderer fetches them via onUiTermData
 * subscription).
 *
 * Lifetime: tabs aren't persisted across app launches — this is a
 * scratch surface, same lifecycle as the Codex side-chat.
 */
const NO_SESSION_BUCKET = "__no_session__";

interface TerminalBucketState {
  tabs: TabState[];
  activeTabId: string | null;
  autoSpawned: boolean;
}

const EMPTY_TERMINAL_BUCKET: TerminalBucketState = {
  tabs: [],
  activeTabId: null,
  autoSpawned: false,
};

export function BottomPanel() {
  const { collapsed, toggle } = useBottomBarCollapse();
  const { themeId, effective } = useTheme();
  const active = useSessionStore(selectActive);
  const sessionKey = active?.id ?? NO_SESSION_BUCKET;
  const [buckets, setBuckets] = useState<Record<string, TerminalBucketState>>(
    {},
  );
  const bucket = buckets[sessionKey] ?? EMPTY_TERMINAL_BUCKET;
  const { tabs, activeTabId } = bucket;

  const updateBucket = useCallback(
    (update: (current: TerminalBucketState) => TerminalBucketState) => {
      setBuckets((currentBuckets) => {
        const current = currentBuckets[sessionKey] ?? EMPTY_TERMINAL_BUCKET;
        const next = update(current);
        if (next === current) return currentBuckets;
        return { ...currentBuckets, [sessionKey]: next };
      });
    },
    [sessionKey],
  );

  const spawnTab = useCallback(async () => {
    const spawnSessionKey = sessionKey;
    const cwd = active?.cwd || undefined;
    setBuckets((currentBuckets) => {
      const current = currentBuckets[spawnSessionKey]
        ?? EMPTY_TERMINAL_BUCKET;
      return {
        ...currentBuckets,
        [spawnSessionKey]: { ...current, autoSpawned: true },
      };
    });
    // 80x24 is the "VT220 default" every shell expects; the fit addon
    // will resize on the next frame anyway, so the visible terminal
    // never renders at this resolution.
    const { terminalId } = await window.backchat.uiTermSpawn({
      cwd,
      cols: 80,
      rows: 24,
    });
    const label = cwd
      ? shortCwdLabel(cwd)
      : `shell-${terminalId.slice(-4)}`;
    setBuckets((currentBuckets) => {
      const current = currentBuckets[spawnSessionKey]
        ?? EMPTY_TERMINAL_BUCKET;
      return {
        ...currentBuckets,
        [spawnSessionKey]: {
          ...current,
          tabs: [...current.tabs, {
            id: terminalId,
            label,
            alive: true,
            cancellationRequested: false,
          }],
          activeTabId: terminalId,
          autoSpawned: true,
        },
      };
    });
  }, [active?.cwd, sessionKey]);

  // Auto-spawn on first open. We can't do this in collapsed state —
  // that would spawn a shell the user hasn't asked for. The check is
  // `!collapsed && no tabs && haven't auto-spawned`.
  useEffect(() => {
    if (collapsed) return;
    if (tabs.length > 0) return;
    if (bucket.autoSpawned) return;
    void spawnTab();
  }, [bucket.autoSpawned, collapsed, tabs.length, spawnTab]);

  // Re-allow auto-spawn after all tabs are closed and the panel is
  // re-opened — otherwise re-opening an empty panel leaves the user
  // staring at the empty tab bar with no shell.
  useEffect(() => {
    if (tabs.length !== 0 || !collapsed || !bucket.autoSpawned) return;
    updateBucket((current) => ({ ...current, autoSpawned: false }));
  }, [bucket.autoSpawned, collapsed, tabs.length, updateBucket]);

  // Listen for terminal exits — mark tab "alive: false" so its X turns
  // into a "close finished tab" affordance without trying to dispose a
  // dead pid.
  useEffect(() => {
    const off = window.backchat.onUiTermExit((f) => {
      setBuckets((currentBuckets) => {
        let changed = false;
        const next = Object.fromEntries(
          Object.entries(currentBuckets).map(([key, current]) => {
            const tabs = current.tabs.map((tab) => {
              if (tab.id !== f.terminalId) return tab;
              changed = true;
              return { ...tab, alive: false };
            });
            return [key, changed ? { ...current, tabs } : current];
          }),
        );
        return changed ? next : currentBuckets;
      });
    });
    return off;
  }, []);

  const closeTab = useCallback(
    async (id: string) => {
      const target = tabs.find((t) => t.id === id);
      if (target?.alive) {
        updateBucket((current) => ({
          ...current,
          tabs: current.tabs.map((tab) =>
            tab.id === id ? { ...tab, cancellationRequested: true } : tab
          ),
        }));
        try {
          await window.backchat.uiTermDispose({ terminalId: id });
        } catch {
          updateBucket((current) => ({
            ...current,
            tabs: current.tabs.map((tab) =>
              tab.id === id ? { ...tab, cancellationRequested: false } : tab
            ),
          }));
        }
        return;
      }
      const next = tabs.filter((t) => t.id !== id);
      const wasActive = activeTabId === id;
      updateBucket((current) => ({
        ...current,
        tabs: next,
        activeTabId: wasActive
          ? next.length > 0 ? next[next.length - 1]!.id : null
          : current.activeTabId,
      }));
    },
    [tabs, activeTabId, updateBucket],
  );

  if (collapsed) return null;

  return (
    <div className="flex h-full min-h-0 flex-col text-fg">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onPick={(id) => updateBucket((current) => ({
          ...current,
          activeTabId: id,
        }))}
        onSpawn={() => void spawnTab()}
        onClose={(id) => void closeTab(id)}
        onClosePanel={toggle}
      />
      <div className="flex-1 min-h-0 relative">
        {tabs.map((t) => (
          <div
            key={`${t.id}-${themeId}-${effective}`}
            className={cn(
              // Inner padding so xterm.js's canvas doesn't kiss the
              // outer rounded corners. The terminal renders inside
              // this padded box.
              "absolute inset-0 px-4 pb-4",
              t.id === activeTabId ? "visible" : "invisible pointer-events-none",
            )}
          >
            <TerminalTab
              terminalId={t.id}
              cancellationRequested={t.cancellationRequested}
            />
          </div>
        ))}
        {tabs.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
            No terminals — click <PlusIcon className="mx-1 size-3" /> to start one.
          </div>
        )}
      </div>
    </div>
  );
}

interface TabState {
  id: string;
  label: string;
  /** false once the pty exited — UI dims the row but keeps it
   *  selectable so the user can read the last output before closing. */
  alive: boolean;
  /** Kept mounted while the PTY exits so TerminalTab can paint a stable
   *  cancelling/cancelled state before the user removes the finished tab. */
  cancellationRequested: boolean;
}

function TabBar({
  tabs,
  activeTabId,
  onPick,
  onSpawn,
  onClose,
  onClosePanel,
}: {
  tabs: TabState[];
  activeTabId: string | null;
  onPick: (id: string) => void;
  onSpawn: () => void;
  onClose: (id: string) => void;
  onClosePanel: () => void;
}) {
  return (
    <div
      // Header row — image #5 style: no border below, content sits on
      // its own padding. The terminal body inherits the same outer
      // padding so the tab chip and terminal text both share one left
      // edge.
      className="shrink-0 flex items-center gap-1 overflow-x-auto px-4 pt-3 pb-2"
    >
      {tabs.map((t) => {
        const isActive = t.id === activeTabId;
        return (
          <div
            key={t.id}
            // Image #5 tab chip: rounded-md gray pill with terminal
            // icon + truncated label. Active state slightly heavier.
            // No X on the chip — close is on the panel header right.
            className={cn(
              "group inline-flex shrink-0 items-center gap-1.5 rounded-md pl-2 pr-2 text-xs",
              isActive
                ? "app-raised-surface text-fg"
                : "text-fg-muted hover:bg-bg-surface/60",
              !t.alive && "italic opacity-70",
              "transition-colors",
            )}
            style={{ height: "26px" }}
          >
            <button
              type="button"
              onClick={() => onPick(t.id)}
              className="inline-flex items-center gap-1.5 truncate max-w-[160px]"
              title={t.label}
            >
              <SquareTerminalIcon className="size-3.5 shrink-0 text-fg-subtle" />
              <span className="truncate">{t.label}</span>
            </button>
            <button
              type="button"
              onClick={() => onClose(t.id)}
              aria-label={t.alive ? "Cancel terminal" : "Close terminal"}
              data-testid="foreground-terminal-close"
              data-terminal-id={t.id}
              disabled={t.cancellationRequested && t.alive}
              className={cn(
                "inline-flex size-4 items-center justify-center rounded",
                "opacity-0 group-hover:opacity-60",
                "hover:bg-bg/60 hover:opacity-100",
                "transition-opacity disabled:cursor-wait",
              )}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onSpawn}
        aria-label="New terminal"
        title="New terminal"
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
          "text-fg-subtle hover:bg-bg-surface/60 hover:text-fg",
          "transition-colors",
        )}
      >
        <PlusIcon className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={onClosePanel}
        aria-label="Close terminal panel"
        title="Close terminal panel"
        className={cn(
          "ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-md",
          "text-fg-subtle hover:bg-bg-surface/60 hover:text-fg",
          "transition-colors",
        )}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

/** Shorten a cwd to its last path segment for the tab label. `~/foo/
 *  bar/baz` → `baz`. Falls back to "shell" for the root or empty. */
function shortCwdLabel(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const last = trimmed.split("/").pop();
  return last || "shell";
}
