export type AgentMessageIntent =
  | "submit"
  | "queue"
  | "steer"
  | "interrupt"
  | "collect";

export type AgentMessageDelivery =
  | "turn_end"
  | "llm_boundary"
  | "interrupt"
  | "collect"
  | "unsupported";

export type AgentInteractionSource =
  | "codex_product"
  | "claude_code_product"
  | "gemini_cli_product"
  | "hermes_product"
  | "openclaw_product"
  | "pi_product"
  | "generic_acp_v1";

export interface AgentDeliveryCapabilities {
  llmBoundary: boolean;
  interrupt: boolean;
  collect: boolean;
}

export interface AgentInteractionProfile {
  agentId: string;
  source: AgentInteractionSource;
  actions: Record<AgentMessageIntent, AgentMessageDelivery>;
}

export interface RunningMessageDeliveryDecision {
  agentId: string;
  source: AgentInteractionSource;
  intent: AgentMessageIntent;
  requestedDelivery: AgentMessageDelivery;
  effectiveDelivery: AgentMessageDelivery;
  degraded: boolean;
}

export const GENERIC_ACP_DELIVERY_CAPABILITIES: AgentDeliveryCapabilities = {
  llmBoundary: false,
  interrupt: false,
  collect: false,
};

const unsupported: AgentMessageDelivery = "unsupported";

const genericAcpProfile: AgentInteractionProfile = {
  agentId: "*",
  source: "generic_acp_v1",
  actions: {
    submit: "turn_end",
    queue: "turn_end",
    steer: unsupported,
    interrupt: unsupported,
    collect: unsupported,
  },
};

const profiles: Record<string, AgentInteractionProfile> = {
  "codex-acp": {
    agentId: "codex-acp",
    source: "codex_product",
    actions: {
      submit: "turn_end",
      queue: "turn_end",
      steer: "llm_boundary",
      interrupt: unsupported,
      collect: unsupported,
    },
  },
  "claude-acp": {
    agentId: "claude-acp",
    source: "claude_code_product",
    actions: {
      submit: "llm_boundary",
      queue: "turn_end",
      steer: "llm_boundary",
      interrupt: unsupported,
      collect: unsupported,
    },
  },
  gemini: {
    agentId: "gemini",
    source: "gemini_cli_product",
    actions: {
      submit: "turn_end",
      queue: "turn_end",
      steer: unsupported,
      interrupt: unsupported,
      collect: unsupported,
    },
  },
  hermes: {
    agentId: "hermes",
    source: "hermes_product",
    actions: {
      submit: "interrupt",
      queue: "turn_end",
      steer: "llm_boundary",
      interrupt: "interrupt",
      collect: unsupported,
    },
  },
  openclaw: {
    agentId: "openclaw",
    source: "openclaw_product",
    actions: {
      submit: "llm_boundary",
      queue: "turn_end",
      steer: "llm_boundary",
      interrupt: "interrupt",
      collect: "collect",
    },
  },
  // pi's own editor: Enter is a *steer* (delivered after the running
  // assistant turn finishes its tool calls, before the next model call) and
  // Alt+Enter is a *follow-up* (delivered once the agent would otherwise stop)
  // — pi-agent-core README "Steering and Follow-up". Pinned per harness (I10)
  // so the generic profile cannot silently re-map pi. Backchat launches
  // `~/.oma/acp/bin/openma-acp-pi-acp`, which is `@openma/pi-acp`. From 0.1.4
  // that adapter advertises `_meta.steering.supported: true` and implements
  // `_session/steering`, so a negotiated session delivers Enter as
  // llm_boundary steer. A third-party adapter that does not negotiate, such
  // as pi-acp 0.0.33, still degrades Enter to the turn-end queue (its own
  // FIFO: pi follow-up, one-at-a-time, reported as `_meta.piAcp.queueDepth`).
  // The catalogue's `/steering` and `/follow-up` commands only switch pi's
  // drain modes; they are not steer inputs.
  "pi-acp": {
    agentId: "pi-acp",
    source: "pi_product",
    actions: {
      submit: "llm_boundary",
      queue: "turn_end",
      steer: "llm_boundary",
      interrupt: unsupported,
      collect: unsupported,
    },
  },
  opencode: {
    agentId: "opencode",
    source: "generic_acp_v1",
    actions: genericAcpProfile.actions,
  },
};

export function getAgentInteractionProfile(agentId: string | null | undefined): AgentInteractionProfile {
  const id = agentId?.trim();
  if (!id) return { ...genericAcpProfile };
  return profiles[id] ?? { ...genericAcpProfile, agentId: id };
}

export function decideRunningMessageDelivery({
  agentId,
  intent = "submit",
  transport = GENERIC_ACP_DELIVERY_CAPABILITIES,
}: {
  agentId: string | null | undefined;
  intent?: AgentMessageIntent;
  transport?: AgentDeliveryCapabilities;
}): RunningMessageDeliveryDecision {
  const profile = getAgentInteractionProfile(agentId);
  // The negotiated transport is stronger evidence than the registry name:
  // any ACP harness that advertises steering can honor an explicit Steer.
  const requestedDelivery =
    intent === "steer" && transport.llmBoundary
      ? "llm_boundary"
      : profile.actions[intent] ?? unsupported;
  const effectiveDelivery = resolveEffectiveDelivery(requestedDelivery, transport);

  return {
    agentId: profile.agentId,
    source: profile.source,
    intent,
    requestedDelivery,
    effectiveDelivery,
    degraded:
      requestedDelivery !== unsupported &&
      effectiveDelivery !== unsupported &&
      requestedDelivery !== effectiveDelivery,
  };
}

function resolveEffectiveDelivery(
  requested: AgentMessageDelivery,
  transport: AgentDeliveryCapabilities,
): AgentMessageDelivery {
  if (requested === "turn_end" || requested === unsupported) return requested;
  if (requested === "llm_boundary") {
    return transport.llmBoundary ? "llm_boundary" : "turn_end";
  }
  if (requested === "interrupt") {
    return transport.interrupt ? "interrupt" : unsupported;
  }
  if (requested === "collect") {
    return transport.collect ? "collect" : unsupported;
  }
  return unsupported;
}
