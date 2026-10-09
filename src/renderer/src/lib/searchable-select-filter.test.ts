import { describe, expect, it } from "vitest";
import {
  filterSearchableSelectItems,
  fuzzyMatchSearchableSelect,
} from "./searchable-select-filter";

describe("searchable-select-filter", () => {
  it("matches provider tokens and fuzzy substrings", () => {
    const haystack = "Claude 4 Sonnet anthropic-proxy";
    expect(fuzzyMatchSearchableSelect("anthropic", haystack)).toBe(true);
    expect(fuzzyMatchSearchableSelect("anthropic sonnet", haystack)).toBe(true);
    expect(fuzzyMatchSearchableSelect("c4s", haystack)).toBe(true);
    expect(fuzzyMatchSearchableSelect("openai", haystack)).toBe(false);
  });

  it("filters grouped model rows by label and provider", () => {
    const items = [
      { value: "a", label: "GPT 5", groupName: "openai-codex" },
      { value: "b", label: "Claude Sonnet", groupName: "anthropic-proxy" },
      { value: "c", label: "Devin", groupName: "devin" },
    ];
    expect(filterSearchableSelectItems(items, "devin").map((item) => item.value)).toEqual([
      "c",
    ]);
    expect(
      filterSearchableSelectItems(items, "anthropic claude").map((item) => item.value),
    ).toEqual(["b"]);
  });
});
