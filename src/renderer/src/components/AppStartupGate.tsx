import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { OpenmaStartupLoader } from "@/components/OpenmaStartupLoader";

export function AppStartupGate({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["agents"],
    queryFn: () => window.backchat.agentsList(),
    staleTime: 60_000,
    retry: false,
  });

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
