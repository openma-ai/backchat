import { describe, expect, it } from "vitest";
import {
  GENERIC_ACP_DELIVERY_CAPABILITIES,
  decideRunningMessageDelivery,
  getAgentInteractionProfile,
} from "./agent-interaction";

describe("agent interaction profiles", () => {
  it("models Codex as default turn-end queue with explicit steer", () => {
    const codex = getAgentInteractionProfile("codex-acp");

    expect(codex.actions.submit).toBe("turn_end");
    expect(codex.actions.queue).toBe("turn_end");
    expect(codex.actions.steer).toBe("llm_boundary");
  });

  it("models Claude Code style submit as steer-by-default", () => {
    const claude = getAgentInteractionProfile("claude-acp");

    expect(claude.actions.submit).toBe("llm_boundary");
    expect(claude.actions.queue).toBe("turn_end");
  });

  it("models pi like its own editor: Enter steers, follow-up queues", () => {
    const pi = getAgentInteractionProfile("pi-acp");

    expect(pi.source).toBe("pi_product");
    expect(pi.actions.submit).toBe("llm_boundary");
    expect(pi.actions.queue).toBe("turn_end");
    expect(pi.actions.steer).toBe("llm_boundary");
    expect(pi.actions.interrupt).toBe("unsupported");
    expect(pi.actions.collect).toBe("unsupported");
  });

  it("falls back unknown ACP agents to turn-end delivery", () => {
    const generic = getAgentInteractionProfile("some-registry-agent");

    expect(generic.actions.submit).toBe("turn_end");
    expect(generic.source).toBe("generic_acp_v1");
  });
});

describe("decideRunningMessageDelivery", () => {
  it("keeps desired and effective delivery separate when ACP cannot steer", () => {
    const decision = decideRunningMessageDelivery({
      agentId: "codex-acp",
      intent: "steer",
      transport: GENERIC_ACP_DELIVERY_CAPABILITIES,
    });

    expect(decision.requestedDelivery).toBe("llm_boundary");
    expect(decision.effectiveDelivery).toBe("turn_end");
    expect(decision.degraded).toBe(true);
  });

  it("uses llm-boundary delivery when the transport advertises it", () => {
    const decision = decideRunningMessageDelivery({
      agentId: "codex-acp",
      intent: "steer",
      transport: { llmBoundary: true, interrupt: false, collect: false },
    });

    expect(decision.requestedDelivery).toBe("llm_boundary");
    expect(decision.effectiveDelivery).toBe("llm_boundary");
    expect(decision.degraded).toBe(false);
  });

  it("degrades a pi submit to the adapter queue until _session/steering is negotiated", () => {
    // pi-acp 0.0.33 does not advertise `_meta.steering.supported`, so a
    // running-time Enter can only reach the adapter's own FIFO (pi follow-up).
    const stock = decideRunningMessageDelivery({
      agentId: "pi-acp",
      intent: "submit",
      transport: GENERIC_ACP_DELIVERY_CAPABILITIES,
    });

    expect(stock.source).toBe("pi_product");
    expect(stock.requestedDelivery).toBe("llm_boundary");
    expect(stock.effectiveDelivery).toBe("turn_end");
    expect(stock.degraded).toBe(true);

    // An adapter carrying svkozak/pi-acp#115 negotiates the extension and
    // Enter becomes pi's native steer with no host change.
    const negotiated = decideRunningMessageDelivery({
      agentId: "pi-acp",
      intent: "submit",
      transport: { llmBoundary: true, interrupt: false, collect: false },
    });

    expect(negotiated.effectiveDelivery).toBe("llm_boundary");
    expect(negotiated.degraded).toBe(false);
  });

  it("does not pretend interrupt/collect can be delivered by generic ACP", () => {
    const interrupt = decideRunningMessageDelivery({
      agentId: "hermes",
      intent: "submit",
      transport: GENERIC_ACP_DELIVERY_CAPABILITIES,
    });
    const collect = decideRunningMessageDelivery({
      agentId: "openclaw",
      intent: "collect",
      transport: GENERIC_ACP_DELIVERY_CAPABILITIES,
    });

    expect(interrupt.effectiveDelivery).toBe("unsupported");
    expect(collect.effectiveDelivery).toBe("unsupported");
  });
});
