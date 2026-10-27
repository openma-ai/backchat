import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { AgentInfo } from "@shared/api";

/**
 * Canonical renderer cache for Agent discovery and managed-runtime state.
 * Every surface reads and writes this key so installs, upgrades, auth, and
 * version availability cannot diverge between the sidebar and Settings.
 */
export const AGENTS_QUERY_KEY = ["agents"] as const;

/**
 * Keep the canonical agent cache in step with the main process.
 *
 * The background harness auto-updater can move an agent to a new version
 * while the app is open. The main process pushes the fresh list when that
 * settles, so the combined update status stops reporting a stale "update
 * available" for an agent that is already upgraded.
 */
export function useAgentsChangedSubscription(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribe = window.backchat.onAgentsChanged((agents: AgentInfo[]) => {
      queryClient.setQueryData<AgentInfo[]>(AGENTS_QUERY_KEY, agents);
    });
    return unsubscribe;
  }, [queryClient]);
}
