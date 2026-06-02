import { useEffect, useCallback } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { sessionStore, selectActive } from "@/lib/session-store";
import { useSessionStore } from "@/lib/session-store";

/**
 * ShellLayout — root-route layout that wires sidebar + topbar around the
 * routed page. The previous design had ChatView own its own composer / state;
 * with router we keep AppShell as a stable frame and let pages (Chat /
 * Settings) render into <main>.
 *
 * Side-effects:
 *   - subscribes to session events on mount and forwards to the store
 *   - re-announces active sessions after a window reload
 *
 * Both effects belong here, not in pages — pages mount/unmount as the user
 * navigates and we'd lose events / re-subscribe redundantly otherwise.
 */
export function ShellLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const off = window.openma.onSessionEvent((e) => sessionStore.apply(e));
    void window.openma.sessionAnnounce();
    // Seed sidebar from persisted state on first mount. This is what makes
    // yesterday's chats appear in the sidebar after a relaunch, without
    // spawning their ACP children — those happen lazily on first prompt.
    void window.openma
      .sessionsList(200)
      .then((rows) => sessionStore.seedPersisted(rows));
    return off;
  }, []);

  const cancelActive = useCallback(() => {
    const active = sessionStore.active();
    if (active?.activeTurnId) {
      void window.openma.sessionCancel({
        session_id: active.id,
        turn_id: active.activeTurnId,
      });
    }
  }, []);

  // Read active so the topbar re-renders on session changes via this layout.
  // (Topbar reads it directly too, but having the layout subscribe means a
  // session.ready arriving while Settings is open still updates the
  // sidebar state, even though settings doesn't read it.)
  void useSessionStore(selectActive);

  return (
    <AppShell sidebar={<Sidebar />} topbar={<Topbar onCancel={cancelActive} />}>
      {children}
    </AppShell>
  );
}