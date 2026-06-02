import { useEffect, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/shell/AppShell";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { BrokerModal } from "@/components/shell/BrokerModal";
import { CommandPalette } from "@/components/shell/CommandPalette";
import {
  newDraftSession,
  sessionStore,
  selectActive,
} from "@/lib/session-store";
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
 *   - listens for native-menu pushes (MenuNavigate / MenuAction)
 */
export function ShellLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  useEffect(() => {
    const off = window.openma.onSessionEvent((e) => sessionStore.apply(e));
    void window.openma.sessionAnnounce();
    void window.openma
      .sessionsList(200)
      .then((rows) => sessionStore.seedPersisted(rows));
    return off;
  }, []);

  useEffect(() => {
    const offNav = window.openma.onMenuNavigate((path) => {
      void navigate({ to: path as never });
    });
    const offAct = window.openma.onMenuAction((action) => {
      if (action === "new-chat") {
        const sid = newDraftSession();
        void navigate({
          to: "/chat/$sessionId",
          params: { sessionId: sid },
        });
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
      void window.openma.sessionCancel({
        session_id: active.id,
        turn_id: active.activeTurnId,
      });
    }
  }, []);

  void useSessionStore(selectActive);

  return (
    <AppShell sidebar={<Sidebar />} topbar={<Topbar onCancel={cancelActive} />}>
      {children}
      <BrokerModal />
      <CommandPalette />
    </AppShell>
  );
}