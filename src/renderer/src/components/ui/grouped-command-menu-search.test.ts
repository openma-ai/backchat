import { describe, expect, it } from "vitest";

import type { GroupedCommandMenuGroup } from "./grouped-command-menu";
import {
  applyGroupedCommandMenuSearch,
  scoreGroupedCommandMenuItem,
} from "./grouped-command-menu-search";

const agentItems: GroupedCommandMenuGroup[] = [
  {
    items: [
      {
        id: "agor",
        value: "agoragentic-acp Agoragentic",
        keywords: ["agoragentic-acp", "Agoragentic"],
        onSelect: () => {},
        children: "agor",
      },
      {
        id: "anti",
        value: "antigravity-acp Antigravity",
        keywords: ["antigravity-acp", "Antigravity"],
        onSelect: () => {},
        children: "anti",
      },
    ],
  },
];

describe("applyGroupedCommandMenuSearch", () => {
  it("returns groups unchanged when the query is empty", () => {
    expect(applyGroupedCommandMenuSearch(agentItems, "")).toEqual(agentItems);
  });

  it("orders matches by cmdk defaultFilter score within each group", () => {
    const result = applyGroupedCommandMenuSearch(agentItems, "an");
    expect(result).toHaveLength(1);
    expect(result[0]?.items.map((item) => item.id)).toEqual(["anti", "agor"]);
  });

  it("keeps separate groups and headings while filtering", () => {
    const groups: GroupedCommandMenuGroup[] = [
      {
        heading: "Projects",
        items: [
          {
            id: "a",
            value: "alpha",
            onSelect: () => {},
            children: "a",
          },
        ],
      },
      {
        heading: "Recent",
        items: [
          {
            id: "b",
            value: "beta",
            onSelect: () => {},
            children: "b",
          },
        ],
      },
    ];
    const filtered = applyGroupedCommandMenuSearch(groups, "alpha");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.heading).toBe("Projects");
    expect(filtered.map((group) => group.heading)).toEqual(["Projects"]);
  });

  it("scores indexed project values from the path segment after the index", () => {
    const groups: GroupedCommandMenuGroup[] = [
      {
        items: [
          {
            id: "browse",
            value: "Browse… browse",
            keywords: ["Browse…", "browse"],
            onSelect: () => {},
            children: "browse",
          },
          {
            id: "none",
            value: "No project — use a per-chat folder no project",
            keywords: ["No project — use a per-chat folder", "no project"],
            onSelect: () => {},
            children: "none",
          },
        ],
      },
    ];
    const ranked = applyGroupedCommandMenuSearch(groups, "re")[0]?.items.map(
      (item) => item.id,
    );
    expect(ranked).toEqual(["none", "browse"]);
  });
});

describe("scoreGroupedCommandMenuItem", () => {
  it("returns 1 for an empty query", () => {
    const item = agentItems[0]!.items[0]!;
    expect(scoreGroupedCommandMenuItem(item, "")).toBe(1);
  });
});
