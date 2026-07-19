import { describe, expect, it } from "vitest";

import { activityPresentationPolicy } from "./activity-presentation-policy";

describe("activityPresentationPolicy", () => {
  it("dispatches Codex presentation behavior explicitly", () => {
    expect(activityPresentationPolicy("codex-acp")).toEqual({
      persistThoughtTimeline: false,
      showLatestThoughtStatus: true,
      groupToolsAcrossThoughts: true,
    });
  });

  it.each([undefined, "", "pi-acp", "claude-acp"])(
    "keeps generic ACP behavior for %s",
    (agentId) => {
      expect(activityPresentationPolicy(agentId)).toEqual({
        persistThoughtTimeline: true,
        showLatestThoughtStatus: false,
        groupToolsAcrossThoughts: false,
      });
    },
  );
});
