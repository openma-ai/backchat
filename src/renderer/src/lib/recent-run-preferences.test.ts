import { describe, expect, it } from "vitest";

import type { AcpSessionConfigOption } from "./session-config-options";
import {
  configValuesFromOptions,
  parseRecentRunPreferences,
  recentConfigOverrides,
  recordRecentRunPreferences,
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
});
