import { describe, expect, test } from "vitest";
import {
  buildConfigOptionSections,
  flattenSelectOptions,
  selectedConfigOptionLabel,
  type AcpSessionConfigOption,
} from "./session-config-options";

const modelOption: AcpSessionConfigOption = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "sonnet",
  options: [
    { value: "sonnet", name: "Claude Sonnet" },
    { value: "opus", name: "Claude Opus" },
  ],
};

describe("session config options", () => {
  test("groups model, mode, thought, and custom options in run-menu order", () => {
    const sections = buildConfigOptionSections([
      {
        id: "custom-flag",
        name: "Web search",
        type: "boolean",
        currentValue: true,
      },
      {
        id: "thought",
        name: "Reasoning",
        category: "thought_level",
        type: "select",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "code",
        options: [{ value: "code", name: "Code" }],
      },
      modelOption,
    ]);

    expect(sections.map((section) => section.category)).toEqual([
      "model",
      "mode",
      "thought_level",
      "custom",
    ]);
    expect(sections.map((section) => section.label)).toEqual([
      "Model",
      "Mode",
      "Thought",
      "Options",
    ]);
  });

  test("flattens grouped select options without losing labels", () => {
    const flat = flattenSelectOptions({
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: "review",
      options: [
        {
          group: "work",
          name: "Work",
          options: [
            { value: "code", name: "Code" },
            { value: "review", name: "Review" },
          ],
        },
      ],
    });

    expect(flat).toEqual([
      { value: "code", name: "Code", groupName: "Work" },
      { value: "review", name: "Review", groupName: "Work" },
    ]);
  });

  test("uses the selected value label for menu summaries", () => {
    expect(selectedConfigOptionLabel(modelOption)).toBe("Claude Sonnet");
  });
});
