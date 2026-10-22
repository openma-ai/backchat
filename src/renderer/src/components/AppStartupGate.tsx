import { useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";
export function AppStartupGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: () => window.backchat.agentsList({ readiness: "snapshot" }),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    let cancelled = false;
    void window.backchat.agentsList({ readiness: "ready" }).then((agents) => {
      if (!cancelled) {
        queryClient.setQueryData(
          AGENTS_QUERY_KEY,
          (current: typeof agents | undefined) =>
            mergeAgentsWithoutAuth(current ?? [], agents),
        );
      }
    }).catch((error) => {
      console.error("Agent startup warmup failed", error);
    });
    return () => { cancelled = true; };
  }, [queryClient]);

  return children;
}

/** Background warmup may attach auth; the composer ignores it until live probe. */
function mergeAgentsWithoutAuth(
  current: Awaited<ReturnType<typeof window.backchat.agentsList>>,
  warmed: Awaited<ReturnType<typeof window.backchat.agentsList>>,
): typeof warmed {
  if (current.length === 0) {
    return warmed.map(({ auth: _auth, ...agent }) => agent);
  }
  const warmedById = new Map(warmed.map((agent) => [agent.id, agent]));
  return current.map((agent) => {
    const next = warmedById.get(agent.id);
    if (!next) return agent;
    const { auth: _auth, ...rest } = next;
    return { ...agent, ...rest };
  });
}
