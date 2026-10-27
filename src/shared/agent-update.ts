/**
 * Managed-agent update state.
 *
 * The App update vocabulary (see app-update.ts) and the managed-agent
 * vocabulary deliberately share one status language — idle / checking /
 * up to date / update available / upgrading / error. About renders both
 * under a single "Check for updates" control, so the two surfaces have to
 * agree on words instead of inventing a parallel thesaurus.
 */

export type AgentUpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "updateAvailable"
  | "upgrading"
  | "error";

export interface AgentUpdateState {
  status: AgentUpdateStatus;
  /** Agent currently being upgraded, when status is "upgrading". */
  agentId: string | null;
  /** Display label of the agent being upgraded, when status is "upgrading". */
  agentLabel: string | null;
  /** Managed agents with a newer version available after the last check. */
  updatesAvailable: number;
  /** Failure detail from the last check, when status is "error". */
  error: string | null;
  /** ISO timestamp of the last state change. */
  updatedAt: string;
}

/** Structural subset of `AgentInfo` needed to summarize update availability. */
export interface AgentUpdateCandidate {
  id: string;
  label?: string;
  updateAvailable?: boolean;
}

export function initialAgentUpdateState(): AgentUpdateState {
  return {
    status: "idle",
    agentId: null,
    agentLabel: null,
    updatesAvailable: 0,
    error: null,
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * Derive the managed-agent half of the update status from the agent list.
 *
 * The registry list is the source of truth: an agent is "update available"
 * when the registry reports a newer version than the installed one. An
 * in-flight upgrade outranks that, so the user sees progress instead of a
 * stale "update available" line.
 */
export function summarizeAgentUpdates(
  agents: readonly AgentUpdateCandidate[],
  upgradingAgentId: string | null = null,
): Pick<AgentUpdateState, "status" | "updatesAvailable" | "agentId" | "agentLabel"> {
  const updatesAvailable = agents.filter((agent) => agent.updateAvailable).length;
  if (upgradingAgentId) {
    const upgrading = agents.find((agent) => agent.id === upgradingAgentId);
    return {
      status: "upgrading",
      updatesAvailable,
      agentId: upgradingAgentId,
      agentLabel: upgrading?.label ?? null,
    };
  }
  if (updatesAvailable > 0) {
    return {
      status: "updateAvailable",
      updatesAvailable,
      agentId: null,
      agentLabel: null,
    };
  }
  return {
    status: "upToDate",
    updatesAvailable: 0,
    agentId: null,
    agentLabel: null,
  };
}

/** Same vocabulary as the App update, so both rows read as one product. */
export function agentUpdateStateFrom(
  agents: readonly AgentUpdateCandidate[],
  upgradingAgentId: string | null = null,
  updatedAt: string = new Date().toISOString(),
): AgentUpdateState {
  const summary = summarizeAgentUpdates(agents, upgradingAgentId);
  return {
    ...summary,
    error: null,
    updatedAt,
  };
}
