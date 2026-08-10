import { describe, expect, it } from "vitest";

import { activityPresentationPolicy } from "./activity-presentation-policy";

describe("activityPresentationPolicy", () => {
  it("dispatches Codex presentation behavior explicitly", () => {
    // Codex's thinking is a passing state: the block is drawn while it reasons
    // and is not kept in the record afterwards.
    expect(activityPresentationPolicy("codex-acp")).toEqual({
      persistThoughtTimeline: false,
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
