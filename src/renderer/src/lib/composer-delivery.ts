import {
  GENERIC_ACP_DELIVERY_CAPABILITIES,
  decideRunningMessageDelivery,
  getAgentInteractionProfile,
  type AgentDeliveryCapabilities,
  type AgentMessageIntent,
  type RunningMessageDeliveryDecision,
} from "@shared/agent-interaction.js";

export interface RunningMessageActionDescription {
  decision: RunningMessageDeliveryDecision;
  disabled: boolean;
  label: string;
  ariaLabel: string;
  title: string;
}

export const BACKCHAT_ACP_DELIVERY_CAPABILITIES: AgentDeliveryCapabilities = {
  llmBoundary: true,
  interrupt: false,
  collect: false,
};

export function describeRunningMessageAction({
  agentId,
  intent,
  transport = GENERIC_ACP_DELIVERY_CAPABILITIES,
}: {
  agentId: string | null | undefined;
  intent: AgentMessageIntent;
  transport?: AgentDeliveryCapabilities;
}): RunningMessageActionDescription {
  const decision = decideRunningMessageDelivery({ agentId, intent, transport });
  const disabled = decision.effectiveDelivery === "unsupported";
  const label = labelForDecision(decision);
  return {
    decision,
    disabled,
    label,
    ariaLabel: `${label} (Enter)`,
    title: titleForDecision(decision, label),
  };
}

export function shouldOfferExplicitSteer(
  agentId: string | null | undefined,
): boolean {
  const profile = getAgentInteractionProfile(agentId);
  return profile.actions.steer === "llm_boundary";
}

function labelForDecision(decision: RunningMessageDeliveryDecision): string {
  switch (decision.effectiveDelivery) {
    case "turn_end":
      return "Queue";
    case "llm_boundary":
      return "Steer";
    case "interrupt":
      return "Interrupt";
    case "collect":
      return "Collect";
    case "unsupported":
      return "Unsupported";
  }
}

function titleForDecision(
  decision: RunningMessageDeliveryDecision,
  label: string,
): string {
  if (decision.degraded && decision.requestedDelivery === "llm_boundary") {
    return "Steer is not available over this ACP transport; queue for next turn";
  }
  switch (decision.effectiveDelivery) {
    case "turn_end":
      return "Queue for next turn";
    case "llm_boundary":
      return "Steer at the next model boundary";
    case "interrupt":
      return "Interrupt the active run";
    case "collect":
      return "Collect without sending yet";
    case "unsupported":
      return `${label} is not available for this agent transport`;
  }
}
