import { describe, expect, test } from "vitest";
import {
  buildConfigOptionSections,
  buildComposerConfigOptions,
  buildRunMenuConfigOptionSections,
  configModeOptionPresentation,
  findModeConfigOption,
  findPermissionModeConfigOption,
  configSelectItemHint,
  flattenSelectOptions,
  isWorkspaceAccessPermissionMode,
  permissionModeMenuItems,
  probedPermissionModeValues,
  probedPermissionModeSelectOptions,
  isFastModeConfigOption,
  isAgentPresetConfigOption,
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
  test("groups model, mode, thought, model config, and custom options in run-menu order", () => {
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
      {
        id: "fast",
        name: "Fast mode",
        category: "model_config",
        type: "boolean",
        currentValue: false,
      },
      modelOption,
    ]);

    expect(sections.map((section) => section.category)).toEqual([
      "model",
      "mode",
      "thought_level",
      "model_config",
      "custom",
    ]);
    expect(sections.map((section) => section.label)).toEqual([
      "Model",
      "Mode",
      "Thought",
      "Model options",
      "Options",
    ]);
  });

  test("model select hints use provider group name, not generic Model title", () => {
    const hint = configSelectItemHint(
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "sonnet",
        options: [
          {
            group: "anthropic",
            name: "anthropic-proxy",
            options: [{ value: "sonnet", name: "Claude Sonnet" }],
          },
        ],
      },
      {
        value: "sonnet",
        name: "Claude Sonnet",
        groupName: "anthropic-proxy",
      },
    );
    expect(hint).toBe("anthropic-proxy");
    expect(
      configSelectItemHint(
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "solo",
          options: [{ value: "solo", name: "Solo" }],
        },
        { value: "solo", name: "Solo" },
      ),
    ).toBeUndefined();
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
        id: "fast",
        name: "Fast mode",
        category: "model_config",
        type: "boolean",
        currentValue: false,
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
    expect(findPermissionModeConfigOption(options)).toEqual(modeOption);
    expect(isFastModeConfigOption(options[2]!)).toBe(true);
    expect(isFastModeConfigOption(options[3]!)).toBe(true);
    expect(isAgentPresetConfigOption({
      id: "agent",
      name: "Agent",
      type: "select",
      currentValue: "standard",
      options: [{ value: "standard", name: "Standard" }],
    })).toBe(true);
    expect(isAgentPresetConfigOption({
      id: "preset",
      name: "Preset",
      type: "select",
      currentValue: "standard",
      options: [{ value: "standard", name: "Standard" }],
    })).toBe(true);
    expect(isAgentPresetConfigOption({
      id: "telemetry",
      name: "Telemetry",
      type: "boolean",
      currentValue: false,
    })).toBe(false);
    expect(
      buildRunMenuConfigOptionSections(options).flatMap((section) =>
        section.options.map((option) => option.id),
      ),
    ).toEqual(["model", "fast", "fast-mode"]);
    expect(buildComposerConfigOptions(options).map((option) => option.id)).toEqual([
      "telemetry",
    ]);
  });

  test("prefers sandbox mode over collaboration_mode for the permission chip", () => {
    const sandboxMode: AcpSessionConfigOption = {
      id: "collaboration_mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: "default",
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan" },
      ],
    };
    const permissionMode: AcpSessionConfigOption = {
      id: "mode",
      name: "Session mode",
      category: "mode",
      type: "select",
      currentValue: "agent",
      options: [
        { value: "read-only", name: "Ask for approval" },
        { value: "agent", name: "Approve for me" },
        { value: "agent-full-access", name: "Full access" },
        { value: "workspace-access", name: "Workspace access" },
      ],
    };

    expect(findModeConfigOption([sandboxMode, permissionMode])).toEqual(sandboxMode);
    expect(findPermissionModeConfigOption([sandboxMode, permissionMode])).toEqual(
      permissionMode,
    );
  });

  test("caps permission mode menu items to harness probe config_options", () => {
    const sessionOptions = [
      { value: "read-only", name: "Ask for approval" },
      { value: "agent", name: "Approve for me" },
      { value: "agent-full-access", name: "Full access" },
      { value: "workspace-access", name: "Workspace access" },
    ];
    const probe = {
      config_options: [{
        id: "mode",
        name: "Session mode",
        category: "mode",
        type: "select",
        currentValue: "agent",
        options: [
          { value: "read-only", name: "Ask for approval" },
          { value: "agent", name: "Approve for me" },
          { value: "agent-full-access", name: "Full access" },
        ],
      }],
    };

    expect(probedPermissionModeValues(probe)).toEqual(new Set([
      "read-only",
      "agent",
      "agent-full-access",
    ]));
    expect(
      permissionModeMenuItems({
        id: "mode",
        name: "Session mode",
        category: "mode",
        type: "select",
        currentValue: "agent",
        options: sessionOptions,
      }, probe).map((option) => option.value),
    ).toEqual(["read-only", "agent", "agent-full-access"]);
    expect(isWorkspaceAccessPermissionMode("workspace-access")).toBe(true);
    expect(configModeOptionPresentation({
      value: "workspace-access",
      name: "Workspace access",
    }).label).toBe("Workspace access");
  });

  test("does not union session_modes into config_option mode probe catalog", () => {
    const probe = {
      config_options: [{
        id: "mode",
        name: "Session mode",
        category: "mode",
        type: "select",
        currentValue: "agent",
        options: [
          { value: "read-only", name: "Ask for approval" },
          { value: "agent", name: "Approve for me" },
          { value: "agent-full-access", name: "Full access" },
        ],
      }],
      session_modes: {
        currentModeId: "workspace-access",
        availableModes: [
          { id: "workspace-access", name: "Workspace access" },
        ],
      },
    };

    expect(probedPermissionModeSelectOptions(probe)?.map((item) => item.value)).toEqual([
      "read-only",
      "agent",
      "agent-full-access",
    ]);
  });

  test("falls back to probed session_modes when config_options omit mode", () => {
    const probe = {
      session_modes: {
        currentModeId: "ask",
        availableModes: [
          { id: "agent", name: "Agent" },
          { id: "plan", name: "Plan" },
          { id: "ask", name: "Ask" },
        ],
      },
    };

    expect(probedPermissionModeValues(probe)).toEqual(new Set(["agent", "plan", "ask"]));
    expect(
      permissionModeMenuItems({
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "ask",
        options: [
          { value: "agent", name: "Agent" },
          { value: "plan", name: "Plan" },
          { value: "ask", name: "Ask" },
          { value: "workspace-access", name: "Workspace access" },
        ],
      }, probe).map((option) => option.value),
    ).toEqual(["agent", "plan", "ask"]);
  });

  test("uses ACP option copy for mode presentation", () => {
    expect(configModeOptionPresentation({
      value: "read-only",
      name: "Read-only",
      description: "Requires approval",
    })).toEqual({
      label: "Read-only",
      hint: "Requires approval",
      tone: "neutral",
    });
    expect(configModeOptionPresentation({
      value: "agent-full-access",
      name: "Agent (full access)",
    })).toEqual({
      label: "Agent (full access)",
      tone: "warning",
    });
  });
});
