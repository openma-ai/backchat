import { describe, expect, it } from "vitest";
import { GENERIC_ACP_DELIVERY_CAPABILITIES } from "@shared/agent-interaction";
import {
  describeRunningMessageAction,
} from "./composer-delivery";

describe("describeRunningMessageAction", () => {
  it("labels Codex default submit as a next-turn queue", () => {
    const action = describeRunningMessageAction({
      agentId: "codex-acp",
      intent: "submit",
      transport: GENERIC_ACP_DELIVERY_CAPABILITIES,
    });

    expect(action.label).toBe("Queue");
    expect(action.decision.requestedDelivery).toBe("turn_end");
    expect(action.disabled).toBe(false);
  });

  it("keeps explicit Codex steer intent while showing ACP degradation", () => {
    const action = describeRunningMessageAction({
      agentId: "codex-acp",
      intent: "steer",
      transport: GENERIC_ACP_DELIVERY_CAPABILITIES,
    });

    expect(action.label).toBe("Queue");
    expect(action.decision.requestedDelivery).toBe("llm_boundary");
    expect(action.decision.effectiveDelivery).toBe("turn_end");
    expect(action.title).toContain("Steer is not available");
  });

  it("marks default Hermes interrupt as unavailable over generic ACP", () => {
    const action = describeRunningMessageAction({
      agentId: "hermes",
      intent: "submit",
      transport: GENERIC_ACP_DELIVERY_CAPABILITIES,
    });

    expect(action.disabled).toBe(true);
    expect(action.label).toBe("Unsupported");
  });
});
