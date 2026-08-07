import { useEffect, useCallback, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  AppShell,
  SidebarCollapseContext,
  RightRailCollapseContext,
  RightRailExpansionContext,
  BottomBarCollapseContext,
} from "@/components/shell/AppShell";
import { bindRightRailSetter } from "@/lib/right-rail";
import { Sidebar } from "@/components/shell/Sidebar";
import { PairTopbar, Topbar } from "@/components/shell/Topbar";
import { SideChatPanel } from "@/components/shell/SideChatPanel";
import { BottomPanel } from "@/components/shell/BottomPanel";
import { BrokerAskBridge } from "@/components/shell/BrokerModal";
import { CommandPalette } from "@/components/shell/CommandPalette";
import {
  sessionStore,
  selectActive,
} from "@/lib/session-store";
import { useSessionStore } from "@/lib/session-store";
import { useSettings } from "@/lib/settings-store";
import { createSideWorkspacePersistence } from "@/lib/side-workspace-persistence";
import { SettingsSidebar } from "@/pages/settings/SettingsLayout";

const COLLAPSE_KEY = "openma:sidebar-collapsed";
const RIGHT_KEY = "openma:right-rail-collapsed";
const BOTTOM_KEY = "openma:bottom-panel-collapsed";

/** Tiny helper for the localStorage-backed collapse pattern used by
 *  both panels. Keeps the duplicate try/catch out of the layout. The
 *  initial value is honored only when the key has never been set;
 *  user toggles persist across reloads. Exposes both `toggle` (flip)
 *  and `set` (force a value) — `set` is used by features that want
 *  to ensure the panel is visible regardless of its prior state,
 *  e.g. auto-opening an HTML preview should expand the right rail
 *  if it was collapsed but never collapse it if it wasn't. */
function usePersistedCollapse(key: string, initial = false) {
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  const persist = useCallback(
    (value: boolean) => {
      try {
        localStorage.setItem(key, value ? "1" : "0");
      } catch {
        /* private mode — non-fatal */
      }
    },
    [key],
  );
  const toggle = useCallback(() => {
    setCollapsedState((c) => {
      const next = !c;
      persist(next);
      return next;
    });
  }, [persist]);
  const set = useCallback(
    (value: boolean) => {
      setCollapsedState((c) => {
        if (c === value) return c;
        persist(value);
        return value;
      });
    },
    [persist],
  );
  return { collapsed, toggle, set };
}

type RightRailExpansionState = {
  expanded: boolean;
  mainSelected: boolean;
};

const DEFAULT_RIGHT_RAIL_EXPANSION: RightRailExpansionState = {
  expanded: false,
  mainSelected: false,
};

function useRightRailExpansionState(sessionId: string | null) {
  const [states, setStates] = useState<Map<string, RightRailExpansionState>>(
    () => new Map(),
  );
  const current = sessionId
    ? states.get(sessionId) ?? DEFAULT_RIGHT_RAIL_EXPANSION
    : DEFAULT_RIGHT_RAIL_EXPANSION;
  const update = useCallback(
    (updater: (previous: RightRailExpansionState) => RightRailExpansionState) => {
      if (!sessionId) return;
      setStates((previousStates) => {
        const previous = previousStates.get(sessionId)
          ?? DEFAULT_RIGHT_RAIL_EXPANSION;
        const nextState = updater(previous);
        if (
          nextState.expanded === previous.expanded
          && nextState.mainSelected === previous.mainSelected
        ) {
          return previousStates;
        }
        const nextStates = new Map(previousStates);
        if (!nextState.expanded && !nextState.mainSelected) {
          nextStates.delete(sessionId);
        } else {
          nextStates.set(sessionId, nextState);
        }
        return nextStates;
      });
    },
    [sessionId],
  );
  const setExpanded = useCallback((value: boolean) => {
    update((previous) => ({
      expanded: value,
      mainSelected: value ? previous.mainSelected : false,
    }));
  }, [update]);
  const selectMain = useCallback(() => {
    update((previous) => ({ ...previous, mainSelected: true }));
  }, [update]);
  const selectPanel = useCallback(() => {
    update((previous) => ({ ...previous, mainSelected: false }));
  }, [update]);
  return {
    expanded: current.expanded,
    mainSelected: current.expanded && current.mainSelected,
    setExpanded,
    selectMain,
    selectPanel,
  };
}

/**
 * ShellLayout — root-route layout that wires sidebar + topbar around the
 * routed page. The previous design had ChatView own its own composer / state;
 * with router we keep AppShell as a stable frame and let pages (Chat /
 * Settings) render into <main>.
 *
 * Side-effects:
 *   - subscribes to session events on mount and forwards to the store
 *   - re-announces active sessions after a window reload
 *   - listens for native-menu pushes (MenuNavigate / MenuAction)
 */
export function ShellLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  // The right side-chat rail and chat-specific chips are chat-surface
  // chrome — they read as noise on `/settings/*` and home (`/`), so
  // they only attach inside chat surfaces. Pair chat uses the same
  // AppShell header slot as normal chat, but renders only logo marks.
  const isChat = location.pathname.startsWith("/chat/");
  const isPair = location.pathname.startsWith("/pair/");
  const isSettings = location.pathname.startsWith("/settings");
  const settings = useSettings();
  const hasEnabledAgent =
    settings?.agents.some((agent) => agent.enabled) ?? false;
  const hasTaskChrome = isChat && hasEnabledAgent;
  const activeSession = useSessionStore(selectActive);
  const sidebarCollapse = usePersistedCollapse(COLLAPSE_KEY);
  // Side chat starts collapsed — users opt in via the rail toggle so
  // a first-launch window doesn't show two empty chat surfaces.
  const rightCollapse = usePersistedCollapse(RIGHT_KEY, true);
  const rightExpansion = useRightRailExpansionState(
    isChat ? activeSession?.id ?? null : null,
  );
  // Bottom terminal panel — opt-in for the same reason.
  const bottomCollapse = usePersistedCollapse(BOTTOM_KEY, true);

  useEffect(() => {
    const sideWorkspacePersistence = createSideWorkspacePersistence(
      sessionStore,
      window.backchat,
    );
    const off = window.backchat.onSessionEvent((e) => sessionStore.apply(e));
    const offBrowser = window.backchat.onBrowserPluginState((event) =>
      sessionStore.syncBrowserPluginState(event)
    );
    void window.backchat.sessionAnnounce();
    void Promise.all([
      window.backchat.sessionsList(200),
      window.backchat.pairsList(),
      window.backchat.sideWorkspacesList(),
    ]).then(([sessions, pairs, sideWorkspaces]) => {
      sessionStore.seedPersisted(sessions);
      sessionStore.seedPersistedPairGroups(pairs);
      sideWorkspacePersistence.hydrate(sideWorkspaces);
      sideWorkspacePersistence.start();
    }).catch((error) => {
      console.warn("Failed to restore persisted workspace state", error);
      // A broken workspace row must not disable persistence for the rest of
      // the app lifetime. Start from the live store and repair on next write.
      sideWorkspacePersistence.start();
    });
    const flushBeforeUnload = () => {
      void sideWorkspacePersistence.flush();
    };
    window.addEventListener("beforeunload", flushBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", flushBeforeUnload);
      sideWorkspacePersistence.dispose();
      off();
      offBrowser();
    };
  }, []);

  useEffect(() => {
    const offNav = window.backchat.onMenuNavigate((path) => {
      void navigate({ to: path as never });
    });
    const offAct = window.backchat.onMenuAction((action) => {
      if (action === "new-chat") {
        sessionStore.newDraft();
        void navigate({ to: "/" });
      } else if (action === "command-palette") {
        // CommandPalette listens on window keydown for ⌘K — replay one.
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
        );
      }
    });
    return () => {
      offNav();
      offAct();
    };
  }, [navigate]);

  const cancelActive = useCallback(() => {
    const active = sessionStore.active();
    if (active?.activeTurnId) {
      void window.backchat.sessionCancel({
        session_id: active.id,
        turn_id: active.activeTurnId,
      });
    }
  }, []);

  // Expose the right-rail collapse setter to module-level imperative
  // callers so non-React code (session store auto-open, plain click
  // handlers) can ensure the panel is visible before pushing a tab.
  useEffect(() => bindRightRailSetter(rightCollapse.set), [rightCollapse.set]);

  return (
    <SidebarCollapseContext.Provider value={sidebarCollapse}>
      <RightRailCollapseContext.Provider value={rightCollapse}>
        <RightRailExpansionContext.Provider value={rightExpansion}>
          <BottomBarCollapseContext.Provider value={bottomCollapse}>
            <AppShell
              sidebar={isSettings ? <SettingsSidebar /> : <Sidebar />}
              topbar={
                isChat ? (
                  <Topbar onCancel={cancelActive} />
                ) : isPair ? (
                  <PairTopbar />
                ) : null
              }
              rightPanel={hasTaskChrome ? <SideChatPanel /> : undefined}
              bottomPanel={hasTaskChrome ? <BottomPanel /> : undefined}
            >
              {children}
              <BrokerAskBridge />
              <CommandPalette />
            </AppShell>
          </BottomBarCollapseContext.Provider>
        </RightRailExpansionContext.Provider>
      </RightRailCollapseContext.Provider>
    </SidebarCollapseContext.Provider>
  );
}
