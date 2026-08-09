import { describe, expect, it } from "vitest";

import {
  planModeExitAction,
  planModeSessionStatePresentation,
} from "./plan-mode-session-state";

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

describe("planModeExitAction", () => {
  const activePlan = {
    id: "collaboration_mode",
    name: "Collaboration mode",
    type: "select" as const,
    currentValue: "plan",
    options: [
      { value: "default", name: "Default" },
      { value: "plan", name: "Plan" },
    ],
  };

  it("prefers the reset value the agent's own command declares", () => {
    expect(planModeExitAction({
      configOptions: [activePlan],
      availableCommands: [{
        name: "plan",
        metadata: {
          commandAction: {
            kind: "setConfigOption",
            configId: "collaboration_mode",
            value: "plan",
            resetValue: "default",
          },
        },
      }],
    })).toEqual({ configId: "collaboration_mode", value: "default" });
  });

  it("falls back to the first non-plan option when no command names a reset", () => {
    expect(planModeExitAction({ configOptions: [activePlan] })).toEqual({
      configId: "collaboration_mode",
      value: "default",
    });
  });

  it("offers no exit when plan mode is not a writable config option", () => {
    expect(planModeExitAction({ configOptions: undefined })).toBeUndefined();
    expect(planModeExitAction({
      configOptions: [{ ...activePlan, currentValue: "default" }],
    })).toBeUndefined();
  });

  it("recognizes and clears a draft-only plan override", () => {
    expect(planModeExitAction({
      draftConfigValues: { collaboration_mode: "plan" },
    })).toEqual({ configId: "collaboration_mode", value: "default" });
    expect(planModeExitAction({
      draftConfigValues: { collaboration_mode: "default" },
    })).toBeUndefined();

    expect(planModeSessionStatePresentation(
      {
        agentId: "codex-acp",
        draftConfigValues: { collaboration_mode: "plan" },
      },
      labels,
    )).toMatchObject({ kind: "plan_mode" });
    expect(planModeSessionStatePresentation(
      {
        agentId: "claude-acp",
        draftConfigValues: { collaboration_mode: "plan" },
      },
      labels,
    )).toBeUndefined();
  });
});
