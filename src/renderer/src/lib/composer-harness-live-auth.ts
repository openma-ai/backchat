import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { AgentInfo } from "@shared/api.js";
import { AGENTS_QUERY_KEY } from "./agent-query";

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
    staleTime: 60_000,
    retry: false,
  });

  return {
    liveAuth: query.data,
    liveProbePending: query.fetchStatus === "fetching",
  };
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
