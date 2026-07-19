import { describe, expect, it } from "vitest";

import * as sessionConfigOptions from "./session-config-options";
import type { AcpSessionConfigOption } from "./session-config-options";

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

describe("agent session config normalization", () => {
  it("keeps complete select and boolean options while dropping malformed probes", () => {
    const normalize = (
      sessionConfigOptions as unknown as {
        normalizeAgentConfigOptions?: (
          value: unknown,
        ) => AcpSessionConfigOption[] | undefined;
      }
    ).normalizeAgentConfigOptions;

    expect(normalize).toBeTypeOf("function");
    expect(normalize?.([
      modelOption,
      {
        id: "telemetry",
        name: "Telemetry",
        type: "boolean",
        currentValue: false,
      },
      { id: "broken-select", type: "select" },
      { id: "broken-boolean", name: "Broken", type: "boolean", currentValue: "false" },
      null,
    ])).toEqual([
      modelOption,
      {
        id: "telemetry",
        name: "Telemetry",
        type: "boolean",
        currentValue: false,
      },
    ]);
    expect(normalize?.({})).toBeUndefined();
    expect(normalize?.([])).toBeUndefined();
  });

  it("applies only type-compatible draft overrides", () => {
    const apply = (
      sessionConfigOptions as unknown as {
        applyConfigOverrides?: (
          options: AcpSessionConfigOption[] | undefined,
          overrides: Record<string, string | boolean>,
        ) => AcpSessionConfigOption[] | undefined;
      }
    ).applyConfigOverrides;
    const telemetry: AcpSessionConfigOption = {
      id: "telemetry",
      name: "Telemetry",
      type: "boolean",
      currentValue: false,
    };

    expect(apply).toBeTypeOf("function");
    expect(apply?.([modelOption, telemetry], {
      model: "opus",
      telemetry: "wrong-type",
    })).toEqual([
      { ...modelOption, currentValue: "opus" },
      telemetry,
    ]);
  });
});
