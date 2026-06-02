import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/shell/AppShell";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";
import { ChatView } from "@/components/chat/ChatView";
import { sessionStore, selectActiveId, useSessionStore } from "@/lib/session-store";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "./styles/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false },
  },
});

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function App() {
  // Forward main → renderer events into the store. Subscribed once at root —
  // every sub-tree reads via useSessionStore.
  useEffect(() => {
    const off = window.openma.onSessionEvent((e) => sessionStore.apply(e));
    void window.openma.sessionAnnounce();
    return off;
  }, []);

  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: () => window.openma.agentsList(),
  });

  const activeId = useSessionStore(selectActiveId);

  const startSession = useCallback(async (agent_id: string) => {
    const session_id = makeId("sess");
    const agentLabel =
      agents.find((a) => a.id === agent_id)?.label ?? agent_id;
    sessionStore.registerStarting(session_id, agent_id, `${agentLabel} · ${session_id.slice(5, 11)}`);
    sessionStore.setActive(session_id);
    await window.openma.sessionStart({ session_id, agent_id });
  }, [agents]);

  const prompt = useCallback(async (session_id: string, text: string) => {
    const turn_id = makeId("turn");
    sessionStore.registerTurn(turn_id, session_id, text);
    await window.openma.sessionPrompt({ session_id, turn_id, text });
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

  return (
    <AppShell
      sidebar={<Sidebar agents={agents} onNewSession={startSession} />}
      topbar={<Topbar onCancel={cancelActive} />}
    >
      <ChatView
        onPrompt={prompt}
        onStartSession={startSession}
        agents={agents}
      />
      <Toaster position="bottom-right" />
    </AppShell>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
