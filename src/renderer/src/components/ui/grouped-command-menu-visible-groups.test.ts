import { describe, expect, it } from "vitest";
import { filterGroupedCommandMenuGroups } from "./grouped-command-menu-visible-groups";
import type { GroupedCommandMenuGroup } from "./grouped-command-menu";

const sampleGroups: readonly GroupedCommandMenuGroup[] = [
  {
    heading: "anthropic-proxy",
    items: [
      {
        id: "a",
        value: "anthropic-proxy-0",
        keywords: ["anthropic-proxy model 0"],
        onSelect: () => {},
        children: "a",
      },
    ],
  },
  {
    heading: "openai-codex",
    items: [
      {
        id: "o",
        value: "openai-codex-0",
        keywords: ["openai-codex model 0"],
        onSelect: () => {},
        children: "o",
      },
    ],
  },
  {
    heading: "devin",
    items: [
      {
        id: "d",
        value: "devin-1",
        keywords: ["devin model 1"],
        onSelect: () => {},
        children: "d",
      },
    ],
  },
];

describe("filterGroupedCommandMenuGroups", () => {
  it("returns all groups when the query is empty", () => {
    expect(filterGroupedCommandMenuGroups(sampleGroups, "")).toHaveLength(3);
  });

  it("drops provider headings with no matching models", () => {
    const filtered = filterGroupedCommandMenuGroups(sampleGroups, "devin model 1");
    expect(filtered.map((group) => group.heading)).toEqual(["devin"]);
  });
});
