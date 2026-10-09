import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";

const AgentsLiveProbeContext = createContext({ pending: true });

export function useAgentsLiveProbePending(): boolean {
  return useContext(AgentsLiveProbeContext).pending;
}

export function AppStartupGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [agentsLiveProbePending, setAgentsLiveProbePending] = useState(true);
  const query = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: () => window.backchat.agentsList({ readiness: "snapshot" }),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (query.isPending) return;
    let cancelled = false;
    setAgentsLiveProbePending(true);
    void window.backchat.agentsList({ readiness: "ready" }).then((agents) => {
      if (!cancelled) queryClient.setQueryData(AGENTS_QUERY_KEY, agents);
    }).catch((error) => {
      console.error("Agent startup probe failed", error);
    }).finally(() => {
      if (!cancelled) setAgentsLiveProbePending(false);
    });
    return () => { cancelled = true; };
  }, [query.isPending, queryClient]);

  return (
    <AgentsLiveProbeContext.Provider value={{ pending: agentsLiveProbePending }}>
      {children}
    </AgentsLiveProbeContext.Provider>
  );
}
