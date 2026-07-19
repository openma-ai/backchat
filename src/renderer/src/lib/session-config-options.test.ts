import { describe, expect, test } from "vitest";
import {
  buildConfigOptionSections,
  buildComposerConfigOptions,
  buildRunMenuConfigOptionSections,
  configModeOptionPresentation,
  findModeConfigOption,
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

  test("moves the ACP mode out of the run menu and into the composer permission control", () => {
    const modeOption: AcpSessionConfigOption = {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: "agent",
      options: [{ value: "agent", name: "Agent" }],
    };
    const options: AcpSessionConfigOption[] = [
      modeOption,
      {
        id: "collaboration_mode",
        name: "Collaboration mode",
        type: "select",
        currentValue: "default",
        options: [
          { value: "default", name: "Default" },
          { value: "plan", name: "Plan" },
        ],
      },
      {
        id: "fast-mode",
        name: "Fast mode",
        type: "select",
        currentValue: "off",
        options: [
          { value: "off", name: "Off" },
          { value: "on", name: "On" },
        ],
      },
      {
        id: "telemetry",
        name: "Telemetry",
        type: "boolean",
        currentValue: false,
      },
      modelOption,
    ];

    expect(findModeConfigOption(options)).toEqual(modeOption);
    expect(
      buildRunMenuConfigOptionSections(options).flatMap((section) =>
        section.options.map((option) => option.id),
      ),
    ).toEqual(["model", "fast-mode"]);
    expect(buildComposerConfigOptions(options).map((option) => option.id)).toEqual([
      "telemetry",
    ]);
  });

  test("uses Codex's official approval semantics for probed session modes", () => {
    expect(configModeOptionPresentation("codex-acp", {
      value: "read-only",
      name: "Read-only",
      description: "Requires approval",
    })).toEqual({
      label: "Ask for approval",
      hint: "Always ask to edit external files and use the internet",
      tone: "neutral",
    });
    expect(configModeOptionPresentation("codex-acp", {
      value: "agent",
      name: "Agent",
    }).label).toBe("Approve for me");
    expect(configModeOptionPresentation("codex-acp", {
      value: "agent-full-access",
      name: "Agent (full access)",
    })).toEqual({
      label: "Full access",
      hint: "Unrestricted access to the internet and any file on your computer",
      tone: "warning",
    });
  });
});
