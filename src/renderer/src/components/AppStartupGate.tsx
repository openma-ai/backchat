import { useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";

export function AppStartupGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: () => window.backchat.agentsList({ readiness: "snapshot" }),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (query.isPending) return;
    let cancelled = false;
    void window.backchat.agentsList({ readiness: "ready" }).then((agents) => {
      if (!cancelled) queryClient.setQueryData(AGENTS_QUERY_KEY, agents);
    }).catch((error) => {
      console.error("Agent startup probe failed", error);
    });
    return () => { cancelled = true; };
  }, [query.isPending, queryClient]);

  return children;
}
