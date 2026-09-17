import { openmaWorkspaceScope } from "@shared/openma";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OpenmaAccountState, OpenmaRunnerState, OpenmaCatalog, OpenmaProjectBinding, OpenmaScope } from "@shared/openma";

export const openmaAccountKey = ["openma-account"] as const;
export function useOpenmaAccount() {
  const client = useQueryClient();
  const result = useQuery<OpenmaAccountState>({
    queryKey: openmaAccountKey,
    queryFn: () => window.backchat.openmaAccountState(),
    staleTime: Infinity,
  });
  useEffect(() => window.backchat.onOpenmaAccount((state) => {
    client.setQueryData(openmaAccountKey, state);
  }), [client]);
  return result;
}

export function useOpenmaRunner() {
  const client = useQueryClient();
  const result = useQuery<OpenmaRunnerState>({ queryKey: ["openma-runner"], queryFn: () => window.backchat.openmaRunnerState(), staleTime: Infinity });
  useEffect(() => window.backchat.onOpenmaRunner((state) => { client.setQueryData(["openma-runner"], state); }), [client]);
  return result;
}

export function useOpenmaCatalog(requestedScope?: OpenmaScope, enabled = true) {
  const { data: account } = useOpenmaAccount();
  const scope = requestedScope ?? (account?.user && account.activeWorkspaceId ? openmaWorkspaceScope(account, account.activeWorkspaceId) : undefined);
  return useQuery<OpenmaCatalog>({
    queryKey: ["openma-catalog", scope?.baseUrl, scope?.userId, scope?.workspaceId],
    queryFn: () => window.backchat.openmaCatalog(scope),
    enabled: enabled && !!scope && account?.status !== "signing_in" && !!account?.workspaces.some((w) => { const candidate = openmaWorkspaceScope(account, w.id); return w.id === scope.workspaceId && !w.expired && candidate.baseUrl === scope.baseUrl && candidate.userId === scope.userId; }),
    staleTime: 10_000, refetchInterval: 30_000, retry: false,
  });
}

export function useOpenmaProjectBindings() {
  const { data: account } = useOpenmaAccount();
  return useQuery<OpenmaProjectBinding[]>({
    queryKey: ["openma-project-bindings", account?.baseUrl, account?.user?.id, account?.activeWorkspaceId],
    queryFn: () => window.backchat.openmaProjectBindings(),
    enabled: account?.status === "signed_in" && !!account.activeWorkspaceId,
  });
}
