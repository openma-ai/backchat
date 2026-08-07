import { describe, expect, test } from "vitest";

import type { SubagentActivity } from "./session-types";
import { subagentActivityLabel } from "./session-workspace-normalization";

function activity(
  overrides: Partial<SubagentActivity> = {},
): SubagentActivity {
  return {
    parentSessionId: "parent-1",
    childSessionId: "child-1",
    viewSessionId: "view-1",
    avatarId: "1_01",
    inheritance: "fresh",
    task: "Reply CHILD_OK only",
    status: "running",
    startedAt: 1,
    updatedAt: 1,
    native: {
      provider: "claude",
      agentType: "general-purpose",
    },
    ...overrides,
  };
}

describe("subagentActivityLabel", () => {
  test("uses the provider-native nickname when one exists", () => {
    expect(subagentActivityLabel(activity({
      native: { provider: "codex", nickname: "Cicero" },
    }))).toBe("Cicero");
  });

  test("assigns a stable local moniker instead of exposing the task as a name", () => {
    expect(subagentActivityLabel(activity())).toBe("Aster");
    expect(subagentActivityLabel(activity({ task: "A completely different task" }))).toBe("Aster");
  });

  test("normalizes one-letter native nicknames into a readable agent name", () => {
    expect(subagentActivityLabel(activity({
      native: { provider: "codex", nickname: "a" },
    }))).toBe("Agent A");
  });
});
