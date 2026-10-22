import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { AgentInfo } from "@shared/api.js";
import { AGENTS_QUERY_KEY } from "./agent-query";
import type { AcpSessionConfigOption } from "./session-config-options";
import type { AcpAvailableCommand } from "./session-store";
import type { SessionRow } from "./session-types";

/** After this many ms, composer auth probe UI should signal a slow but still-active check. */
export const SLOW_HARNESS_PROBE_MS = 12_000;

export const composerHarnessLiveAuthKey = (agentId: string) =>
  ["agents", "live-probe", agentId] as const;

export function useComposerHarnessLiveAuth(agentId: string, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: composerHarnessLiveAuthKey(agentId),
    queryFn: async () => {
      const agents = await window.backchat.agentsList({ liveProbeAgentId: agentId });
      const agent = agents.find((item) => item.id === agentId);
      queryClient.setQueryData(
        AGENTS_QUERY_KEY,
        (current: AgentInfo[] | undefined) => mergeAgentInventory(current ?? [], agents, agentId),
      );
      return agent?.auth ?? null;
    },
    enabled: enabled && agentId.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  const liveProbePending = query.isPending && query.fetchStatus === "fetching";
  const slowAuthProbe = useSlowHarnessProbe(liveProbePending);

  return {
    liveAuth: query.data,
    liveProbePending,
    slowAuthProbe,
  };
}

export function syncLiveSessionHarnessCache(
  queryClient: QueryClient,
  input: {
    agentId?: string | null;
    configOptions?: AcpSessionConfigOption[];
    availableCommands?: AcpAvailableCommand[];
    sessionAuth?: SessionRow["auth"];
    sessionAuthRequired?: boolean;
  },
): void {
  const agentId = input.agentId?.trim();
  if (!agentId) return;

  const hasConfig = Boolean(input.configOptions && input.configOptions.length > 0);
  const hasCommands = Boolean(input.availableCommands && input.availableCommands.length > 0);
  const observedAuthStatus = input.sessionAuth?.status
    ?? (input.sessionAuthRequired ? "needs-auth" : undefined);

  if (!hasConfig && !hasCommands && !observedAuthStatus) return;

  let mergedAuth: AgentInfo["auth"] | null | undefined;
  queryClient.setQueryData<AgentInfo[] | undefined>(AGENTS_QUERY_KEY, (current) => {
    if (!current || current.length === 0) return current;
    let changed = false;
    const next = current.map((agent) => {
      if (agent.id !== agentId) return agent;
      const nextAuth: AgentInfo["auth"] | undefined = observedAuthStatus
        ? {
            ...(agent.auth ?? {}),
            status: observedAuthStatus,
            message:
              input.sessionAuth?.message
              ?? agent.auth?.message
              ?? (observedAuthStatus === "configured"
                ? "ACP auth is configured."
                : "Authentication required."),
            ...(input.sessionAuth?.methodId
              ? { methodId: input.sessionAuth.methodId }
              : {}),
            ...(input.sessionAuth?.methodName
              ? { methodName: input.sessionAuth.methodName }
              : {}),
            ...(input.sessionAuth?.methods
              ? { methods: input.sessionAuth.methods }
              : {}),
            ...(input.sessionAuth?.supportsLogout !== undefined
              ? { supportsLogout: input.sessionAuth.supportsLogout }
              : {}),
          }
        : agent.auth;
      mergedAuth = nextAuth ?? null;
      const nextConfig = hasConfig ? input.configOptions : agent.config_options;
      const nextCommands = hasCommands
        ? input.availableCommands
        : agent.available_commands;
      if (
        nextAuth === agent.auth
        && nextConfig === agent.config_options
        && nextCommands === agent.available_commands
      ) {
        return agent;
      }
      changed = true;
      return {
        ...agent,
        ...(nextAuth ? { auth: nextAuth } : {}),
        ...(nextConfig ? { config_options: nextConfig } : {}),
        ...(nextCommands ? { available_commands: nextCommands } : {}),
      };
    });
    return changed ? next : current;
  });

  if (observedAuthStatus) {
    queryClient.setQueryData<AgentInfo["auth"] | null>(
      composerHarnessLiveAuthKey(agentId),
      (prev) =>
        mergedAuth ?? {
          ...(prev ?? {}),
          status: observedAuthStatus,
          message:
            input.sessionAuth?.message
            ?? prev?.message
            ?? (observedAuthStatus === "configured"
              ? "ACP auth is configured."
              : "Authentication required."),
          ...(input.sessionAuth?.methodId
            ? { methodId: input.sessionAuth.methodId }
            : {}),
          ...(input.sessionAuth?.methodName
            ? { methodName: input.sessionAuth.methodName }
            : {}),
          ...(input.sessionAuth?.methods
            ? { methods: input.sessionAuth.methods }
            : {}),
          ...(input.sessionAuth?.supportsLogout !== undefined
            ? { supportsLogout: input.sessionAuth.supportsLogout }
            : {}),
        },
    );
  }
}

function useSlowHarnessProbe(liveProbePending: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!liveProbePending) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), SLOW_HARNESS_PROBE_MS);
    return () => window.clearTimeout(timer);
  }, [liveProbePending]);
  return slow;
}

function mergeAgentInventory(
  current: AgentInfo[],
  probed: AgentInfo[],
  agentId: string,
): AgentInfo[] {
  const probedAgent = probed.find((item) => item.id === agentId);
  if (!probedAgent) return current.length > 0 ? current : probed.map(stripAuth);
  const byId = new Map((current.length > 0 ? current : probed.map(stripAuth)).map((item) => [item.id, item]));
  byId.set(agentId, probedAgent);
  return [...byId.values()];
}

function stripAuth(agent: AgentInfo): AgentInfo {
  const { auth: _auth, ...rest } = agent;
  return rest;
}
