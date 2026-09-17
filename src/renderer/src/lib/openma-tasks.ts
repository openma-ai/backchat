import { openmaWorkspaceScope } from "@shared/openma";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OpenmaScope } from "@shared/openma";
import { useOpenmaAccount } from "./openma-account";
import { sessionStore } from "./session-store";

export function sameOpenmaScope(a: OpenmaScope, b: OpenmaScope): boolean {
  return a.baseUrl === b.baseUrl && a.userId === b.userId && a.workspaceId === b.workspaceId;
}

/** Each tenant can load/fail independently, including while its group is collapsed. */
export function useOpenmaTenantTasks(scope: OpenmaScope, enabled: boolean) {
  const query = useQuery({
    queryKey: ["openma-tasks", scope.baseUrl, scope.userId, scope.workspaceId],
    queryFn: () => window.backchat.openmaTasksRefresh(scope),
    enabled, retry: false, refetchInterval: 30_000, staleTime: 10_000,
  });
  useEffect(() => {
    if (enabled && query.data) sessionStore.seedOpenmaTasks(query.data.filter((task) => sameOpenmaScope(task, scope)));
  }, [enabled, query.data, scope.baseUrl, scope.userId, scope.workspaceId]);
  return query;
}

/** Scope every delayed result as well as each push. Credentials remain in main. */
export function useOpenmaTasks(): void {
  const { data: account } = useOpenmaAccount();
  const scopesKey = JSON.stringify(account?.user && account.status !== "signing_in" ? account.workspaces.filter((w) => !w.expired).map((w) => openmaWorkspaceScope(account, w.id)) : []);
  useEffect(() => {
    const scopes = JSON.parse(scopesKey) as OpenmaScope[];
    sessionStore.retainOpenmaScopes(scopes);
    if (!scopes.length) return;
    let active = true;
    const matches = (scope: OpenmaScope) => active && scopes.some((candidate) => sameOpenmaScope(candidate, scope));
    const off = window.backchat.onOpenmaTask((snapshot) => {
      if (matches(snapshot.task)) sessionStore.applyOpenmaSnapshot(snapshot);
    });
    const offMetadata = window.backchat.onOpenmaTaskUpdated((task) => {
      if (matches(task)) sessionStore.seedOpenmaTasks([task]);
    });
    void window.backchat.openmaTasksList().then((tasks) => {
      if (active) sessionStore.seedOpenmaTasks(tasks.filter(matches));
    }).catch(() => { /* Tenant refresh displays its own loading error. */ });
    return () => { active = false; off(); offMetadata(); };
  }, [scopesKey]);
}
