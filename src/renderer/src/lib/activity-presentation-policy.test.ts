import { describe, expect, it } from "vitest";

import { activityPresentationPolicy } from "./activity-presentation-policy";

describe("activityPresentationPolicy", () => {
  it("dispatches Codex presentation behavior explicitly", () => {
    // Codex sends real reasoning and it is rendered as a block like every other
    // agent's. What is still specific to it is that a thought does not break a
    // run of tools.
    expect(activityPresentationPolicy("codex-acp")).toEqual({
      persistThoughtTimeline: true,
      groupToolsAcrossThoughts: true,
    });
  });

  it.each([undefined, "", "pi-acp", "claude-acp"])(
    "keeps generic ACP behavior for %s",
    (agentId) => {
      expect(activityPresentationPolicy(agentId)).toEqual({
        persistThoughtTimeline: true,
        groupToolsAcrossThoughts: false,
      });
    },
  );
});
