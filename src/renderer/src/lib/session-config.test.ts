import { describe, expect, it } from "vitest";

import type { SessionConfigOption } from "@shared/session-events.js";
import {
  configOptionCurrentLabel,
  findModelConfigOption,
  flattenConfigSelectOptions,
} from "./session-config";

describe("session config helpers", () => {
  it("finds the ACP model selector by semantic category", () => {
    const options: SessionConfigOption[] = [
      selectOption("mode", "mode", "ask"),
      selectOption("preferred-model", "model", "gpt-5"),
    ];

    expect(findModelConfigOption(options)?.id).toBe("preferred-model");
  });

  it("flattens grouped select values and labels the current value", () => {
    const option: SessionConfigOption = {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "gpt-5",
      options: [
        {
          group: "openai",
          name: "OpenAI",
          options: [
            { value: "gpt-5", name: "GPT-5" },
            { value: "gpt-5-mini", name: "GPT-5 mini" },
          ],
        },
      ],
    };

    expect(flattenConfigSelectOptions(option).map((value) => value.value)).toEqual([
      "gpt-5",
      "gpt-5-mini",
    ]);
    expect(configOptionCurrentLabel(option)).toBe("GPT-5");
  });
});

function selectOption(
  id: string,
  category: string,
  currentValue: string,
): SessionConfigOption {
  return {
    id,
    name: id,
    category,
    type: "select",
    currentValue,
    options: [{ value: currentValue, name: currentValue }],
  };
}
