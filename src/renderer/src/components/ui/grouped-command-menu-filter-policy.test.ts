import { defaultFilter } from "cmdk";
import { describe, expect, it } from "vitest";

import { groupedCommandMenuShouldFilter } from "./grouped-command-menu";

describe("groupedCommandMenuShouldFilter", () => {
  it("delegates filter and ranking to cmdk for every menu mode", () => {
    expect(groupedCommandMenuShouldFilter("project-picker")).toBe(true);
    expect(groupedCommandMenuShouldFilter("grouped-command")).toBe(true);
    expect(groupedCommandMenuShouldFilter("host-picker")).toBe(true);
  });
});

describe("cmdk defaultFilter ranking (grouped command menus)", () => {
  it("prefers antigravity-acp over agoragentic-acp for query an", () => {
    const agor = defaultFilter(
      "agoragentic-acp Agoragentic",
      "an",
      ["agoragentic-acp", "Agoragentic"],
    );
    const anti = defaultFilter(
      "antigravity-acp Antigravity",
      "an",
      ["antigravity-acp", "Antigravity"],
    );
    expect(anti).toBeGreaterThan(agor);
  });

  it("ranks No project before Browse for query re", () => {
    const browse = defaultFilter("Browse… browse", "re", ["Browse…", "browse"]);
    const noProject = defaultFilter(
      "No project — use a per-chat folder no project",
      "re",
      ["No project — use a per-chat folder", "no project"],
    );
    expect(noProject).toBeGreaterThan(browse);
  });
});
