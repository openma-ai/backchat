import { describe, expect, it } from "vitest";
import {
  activeProviderForValue,
  shouldUseProviderSubmenu,
} from "./composer-select-menu-layout";

describe("composer-select-menu-layout", () => {
  it("enables two-level menus for many models across providers", () => {
    const items = [
      { value: "a", label: "A", groupName: "anthropic-proxy" },
      { value: "b", label: "B", groupName: "openai-codex" },
      ...Array.from({ length: 8 }, (_, index) => ({
        value: `x-${index}`,
        label: `X ${index}`,
        groupName: index % 2 === 0 ? "anthropic-proxy" : "openai-codex",
      })),
    ];
    expect(shouldUseProviderSubmenu(items)).toBe(true);
    expect(activeProviderForValue(items, "a")).toBe("anthropic-proxy");
  });

  it("keeps small single-provider lists flat", () => {
    const items = [
      { value: "a", label: "A", groupName: "devin" },
      { value: "b", label: "B", groupName: "devin" },
    ];
    expect(shouldUseProviderSubmenu(items)).toBe(false);
  });
});
