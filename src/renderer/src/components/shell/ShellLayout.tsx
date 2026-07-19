import { useEffect, useCallback, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  AppShell,
  SidebarCollapseContext,
  RightRailCollapseContext,
  BottomBarCollapseContext,
} from "@/components/shell/AppShell";
import { bindRightRailSetter } from "@/lib/right-rail";
import { Sidebar } from "@/components/shell/Sidebar";
import { PairTopbar, Topbar } from "@/components/shell/Topbar";
import { SideChatPanel } from "@/components/shell/SideChatPanel";
import { BottomPanel } from "@/components/shell/BottomPanel";
import { BrokerModal } from "@/components/shell/BrokerModal";
import { CommandPalette } from "@/components/shell/CommandPalette";
import {
  sessionStore,
  selectActive,
} from "@/lib/session-store";
import { useSessionStore } from "@/lib/session-store";
import { createSideWorkspacePersistence } from "@/lib/side-workspace-persistence";

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
  const sidebarCollapse = usePersistedCollapse(COLLAPSE_KEY);
  // Side chat starts collapsed — users opt in via the rail toggle so
  // a first-launch window doesn't show two empty chat surfaces.
  const rightCollapse = usePersistedCollapse(RIGHT_KEY, true);
  // Bottom terminal panel — opt-in for the same reason.
  const bottomCollapse = usePersistedCollapse(BOTTOM_KEY, true);

  useEffect(() => {
    const sideWorkspacePersistence = createSideWorkspacePersistence(
      sessionStore,
      window.backchat,
    );
    const off = window.backchat.onSessionEvent((e) => sessionStore.apply(e));
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
    };
  }, []);

  useEffect(() => {
    const offNav = window.backchat.onMenuNavigate((path) => {
      void navigate({ to: path as never });
    });
    const offAct = window.backchat.onMenuAction((action) => {
      if (action === "new-chat") {
        const id = sessionStore.newDraft();
        void navigate({ to: "/chat/$sessionId", params: { sessionId: id } });
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

  void useSessionStore(selectActive);

  // Expose the right-rail collapse setter to module-level imperative
  // callers so non-React code (session store auto-open, plain click
  // handlers) can ensure the panel is visible before pushing a tab.
  useEffect(() => bindRightRailSetter(rightCollapse.set), [rightCollapse.set]);

  return (
    <SidebarCollapseContext.Provider value={sidebarCollapse}>
      <RightRailCollapseContext.Provider value={rightCollapse}>
        <BottomBarCollapseContext.Provider value={bottomCollapse}>
          <AppShell
            sidebar={<Sidebar />}
            topbar={
              isChat ? (
                <Topbar onCancel={cancelActive} />
              ) : isPair ? (
                <PairTopbar />
              ) : null
            }
            rightPanel={isChat ? <SideChatPanel /> : undefined}
            bottomPanel={<BottomPanel />}
          >
            {children}
            <BrokerModal />
            <CommandPalette />
          </AppShell>
        </BottomBarCollapseContext.Provider>
      </RightRailCollapseContext.Provider>
    </SidebarCollapseContext.Provider>
  );
}
