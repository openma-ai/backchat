export type AgentAction = {
  type: "install" | "upgrade" | "uninstall" | "auth" | "refresh";
  id?: string;
  methodId?: string;
};

export function agentActionKey(action: AgentAction): string {
  return `${action.type}:${action.id ?? "registry"}`;
}

/**
 * Installs are independent registry distributions, so installing one Agent
 * should only lock that row. Mutations that refresh or alter existing setup
 * still take the global lock because they replace the shared Agent snapshot.
 */
export function isInstallActionDisabled(
  agentId: string,
  pendingActions: readonly AgentAction[],
): boolean {
  if (pendingActions.some((action) => action.type !== "install")) return true;
  return pendingActions.some(
    (action) => action.type === "install" && action.id === agentId,
  );
}

/** Stable-partition installing Agents to the top while preserving registry order. */
export function sortAgentsByInstalling<T extends { id: string }>(
  agents: readonly T[],
  installingIds: ReadonlySet<string>,
): T[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort((left, right) => {
      const installingDelta =
        Number(installingIds.has(right.agent.id)) -
        Number(installingIds.has(left.agent.id));
      return installingDelta || left.index - right.index;
    })
    .map(({ agent }) => agent);
}
