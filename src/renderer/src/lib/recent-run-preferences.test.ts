import { describe, expect, it } from "vitest";

import type { AcpSessionConfigOption } from "./session-config-options";
import {
  configValuesFromOptions,
  parseRecentRunPreferences,
  recentConfigOverrides,
  recordRecentRunPreferences,
  resetRecentRunPreferencesForAgent,
} from "./recent-run-preferences";

const options: AcpSessionConfigOption[] = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "gpt-5",
    options: [
      { value: "gpt-5", name: "GPT-5" },
      { value: "gpt-5.6", name: "GPT-5.6" },
    ],
  },
  {
    id: "effort",
    name: "Effort",
    category: "thought_level",
    type: "select",
    currentValue: "medium",
    options: [
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
  {
    id: "fast-mode",
    name: "Fast mode",
    type: "boolean",
    currentValue: false,
  },
];

const agentPresetOptions: AcpSessionConfigOption[] = [
  ...options,
  {
    id: "agent",
    name: "Agent",
    type: "select",
    currentValue: "standard",
    options: [
      { value: "standard", name: "Standard" },
      { value: "code", name: "Code" },
      { value: "cordis", name: "Cordis" },
    ],
  },
];

describe("recent run preferences", () => {
  it("parses invalid persisted data as an empty preference", () => {
    expect(parseRecentRunPreferences(null)).toEqual({
      configByAgent: {},
    });
    expect(parseRecentRunPreferences("{broken")).toEqual({
      configByAgent: {},
    });
  });

  it("restores only values that are still valid for the selected agent", () => {
    expect(recentConfigOverrides({
      agentId: "codex-acp",
      configByAgent: {
        "codex-acp": {
          model: "gpt-5.6",
          effort: "removed",
          "fast-mode": true,
          stale: "ignored",
        },
      },
    }, "codex-acp", options)).toEqual({
      model: "gpt-5.6",
      "fast-mode": true,
    });
  });

  it("does not restore the Agent preset; new chats keep the harness default", () => {
    expect(recentConfigOverrides({
      agentId: "dsh-acp",
      configByAgent: {
        "dsh-acp": {
          model: "gpt-5.6",
          agent: "cordis",
          preset: "minimal",
        },
      },
    }, "dsh-acp", agentPresetOptions)).toEqual({
      model: "gpt-5.6",
    });
  });

  it("persists the actually used agent and full effective configuration", () => {
    let raw: string | null = null;
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    };

    const next = recordRecentRunPreferences({
      agentId: "codex-acp",
      configValues: configValuesFromOptions(options),
    }, storage);

    expect(next).toEqual({
      agentId: "codex-acp",
      configByAgent: {
        "codex-acp": {
          model: "gpt-5",
          effort: "medium",
          "fast-mode": false,
        },
      },
    });
    expect(parseRecentRunPreferences(raw)).toEqual(next);
  });

  it("resets one harness to ACP defaults without losing other harness preferences", () => {
    let raw = JSON.stringify({
      agentId: "kilo",
      configByAgent: {
        kilo: { model: "kilo/nano-banana" },
        opencode: { model: "anthropic/deepseek-v4-flash" },
      },
    });
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    };

    const next = resetRecentRunPreferencesForAgent("kilo", storage);

    expect(next).toEqual({
      agentId: "kilo",
      configByAgent: {
        opencode: { model: "anthropic/deepseek-v4-flash" },
      },
    });
    expect(parseRecentRunPreferences(raw)).toEqual(next);
  });
});
