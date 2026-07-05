import type { Settings } from "@shared/settings";

export function enabledAgentIds(settings: Settings | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!settings) return ids;
  for (const agent of settings.agents) {
    if (agent.enabled) ids.add(agent.id);
  }
  return ids;
}

export function isAgentEnabled(
  settings: Settings | null | undefined,
  agentId: string,
): boolean {
  return enabledAgentIds(settings).has(agentId);
}

export function isAgentRunnable(agent: {
  available?: boolean;
  detected?: boolean;
  installed?: boolean;
}): boolean {
  return !!(agent.available ?? agent.detected) || !!agent.installed;
}
