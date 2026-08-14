export interface AgentCatalogSearchable {
  id: string;
  label: string;
  command?: string;
  installHint?: string;
}

export function filterAgentCatalog<T extends AgentCatalogSearchable>(
  agents: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...agents];

  return agents.filter((agent) =>
    [agent.label, agent.id, agent.command, agent.installHint]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(needle)),
  );
}

/** Stable-partition one promoted agent to the front of either catalog group. */
export function prioritizeAgentCatalog<T extends { id: string }>(
  agents: readonly T[],
  promotedId: string,
): T[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort((left, right) =>
      Number(right.agent.id === promotedId) -
        Number(left.agent.id === promotedId) ||
      left.index - right.index,
    )
    .map(({ agent }) => agent);
}
