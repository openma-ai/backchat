import { useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { OpenmaStartupLoader } from "@/components/OpenmaStartupLoader";
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
    let cancelled = false;
    void window.backchat.agentsList({ readiness: "ready" }).then((agents) => {
      if (!cancelled) queryClient.setQueryData(AGENTS_QUERY_KEY, agents);
    }).catch(() => {
      // The cached inventory remains usable when the background refresh fails.
    });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  if (query.isPending) {
    return (
      <main
        data-testid="app-startup-loader"
        className="flex h-full w-full items-center justify-center bg-bg-sidebar"
      >
        <OpenmaStartupLoader />
      </main>
    );
  }

  return children;
}
