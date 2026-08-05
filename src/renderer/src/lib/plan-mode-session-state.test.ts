import { describe, expect, it } from "vitest";

import { planModeSessionStatePresentation } from "./plan-mode-session-state";

const labels = { label: "Plan", title: "Plan mode is active" };

describe("planModeSessionStatePresentation adapter", () => {
  it("maps Claude current_mode_update plan state into the shared composer GUI", () => {
    expect(
      planModeSessionStatePresentation(
        {
          agentId: "claude-acp",
          currentModeId: "plan",
        },
        labels,
      ),
    ).toEqual({
      id: "mode:claude-acp:plan",
      kind: "plan_mode",
      label: "Plan",
      title: "Plan mode is active",
      icon: "plan",
    });
  });

  it("maps Codex collaboration_mode plan state into the same GUI", () => {
    expect(
      planModeSessionStatePresentation(
        {
          agentId: "codex-acp",
          currentModeId: "agent",
          configOptions: [
            {
              id: "collaboration_mode",
              name: "Collaboration mode",
              type: "select",
              currentValue: "plan",
              options: [
                { value: "default", name: "Default" },
                { value: "plan", name: "Plan" },
              ],
            },
          ],
        },
        labels,
      ),
    ).toEqual({
      id: "mode:codex-acp:plan",
      kind: "plan_mode",
      label: "Plan",
      title: "Plan mode is active",
      icon: "plan",
    });
  });

  it.each([
    {
      agentId: "claude-acp",
      currentModeId: "default",
      configOptions: undefined,
    },
    {
      agentId: "codex-acp",
      currentModeId: "agent",
      configOptions: [
        {
          id: "collaboration_mode",
          name: "Collaboration mode",
          type: "select" as const,
          currentValue: "default",
          options: [
            { value: "default", name: "Default" },
            { value: "plan", name: "Plan" },
          ],
        },
      ],
    },
    {
      agentId: "pi-acp",
      currentModeId: "plan",
      configOptions: undefined,
    },
  ])("does not invent Plan Mode for $agentId outside its declared plan state", (state) => {
    expect(planModeSessionStatePresentation(state, labels)).toBeUndefined();
  });
});
