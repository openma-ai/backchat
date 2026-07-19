import { describe, expect, it } from "vitest";
import * as homeSuggestionFlow from "./home-suggestion-flow";
type SuggestionFlow = {
  prefix: string;
  options: Array<{
    before: string;
    slotLabel: string;
    after: string;
    template: {
      before: string;
      slotLabel: string;
      after: string;
    };
  }>;
};

async function loadFlow(): Promise<
  | ((
      kind: "understand" | "shape" | "refine" | "unblock",
      locale: "en" | "zh-CN",
    ) => SuggestionFlow)
  | undefined
> {
  return import("./home-suggestion-flow")
    .then((module) => module.getHomeSuggestionFlow)
    .catch(() => undefined);
}

describe("home suggestion flow", () => {
  it("transitions predictably between visible, choosing, and dismissed phases", () => {
    const transition = (
      homeSuggestionFlow as unknown as {
        transitionHomeSuggestionPhase?: (
          phase: "visible" | "choosing" | "dismissed",
          event:
            | "select"
            | "back"
            | "template-selected"
            | "user-input"
            | "user-clear"
            | "reset",
        ) => "visible" | "choosing" | "dismissed";
      }
    ).transitionHomeSuggestionPhase;

    expect(transition).toBeTypeOf("function");
    expect(transition?.("visible", "select")).toBe("choosing");
    expect(transition?.("choosing", "back")).toBe("visible");
    expect(transition?.("choosing", "template-selected")).toBe("dismissed");
    expect(transition?.("visible", "user-input")).toBe("dismissed");
    expect(transition?.("dismissed", "user-clear")).toBe("visible");
    expect(transition?.("dismissed", "reset")).toBe("visible");
    expect(transition?.("dismissed", "select")).toBe("dismissed");
  });

  it("serializes a filled template and rejects an empty slot", () => {
    const serialize = (
      homeSuggestionFlow as unknown as {
        serializeSuggestionTemplate?: (
          template: { before: string; slotLabel: string; after: string },
          slotValue: string,
        ) => string;
      }
    ).serializeSuggestionTemplate;
    const template = {
      before: "Help me shape ",
      slotLabel: "idea",
      after: " into a concrete plan",
    };

    expect(serialize).toBeTypeOf("function");
    expect(serialize?.(template, "  a launch plan  ")).toBe(
      "Help me shape a launch plan into a concrete plan",
    );
    expect(serialize?.(template, "  ")).toBe("");
  });

  it("removes the structured slot without losing surrounding composer text", () => {
    const removeSlot = (
      homeSuggestionFlow as unknown as {
        removeSuggestionTemplateSlot?: (
          template: { before: string; slotLabel: string; after: string },
          slotValue: string,
        ) => { text: string; caret: number };
      }
    ).removeSuggestionTemplateSlot;

    expect(removeSlot).toBeTypeOf("function");
    expect(removeSlot?.({
      before: "Help me shape ",
      slotLabel: "idea",
      after: " into a concrete plan",
    }, "launch")).toEqual({
      text: "Help me shape launch into a concrete plan",
      caret: 20,
    });
  });

  it("starts with a short editable prefix before offering full prompts", async () => {
    const getHomeSuggestionFlow = await loadFlow();
    expect(getHomeSuggestionFlow).toBeTypeOf("function");
    const flow = getHomeSuggestionFlow!("understand", "en");

    expect(flow.prefix).toBe("Help me understand");
    expect(flow.options).toHaveLength(4);
    expect(flow.options[0]).toEqual({
      before: "",
      slotLabel: "topic",
      after: " in plain language",
      template: {
        before: "Help me understand ",
        slotLabel: "topic",
        after: " in plain language",
      },
    });
  });

  it("keeps the two-stage choices localized", async () => {
    const getHomeSuggestionFlow = await loadFlow();
    expect(getHomeSuggestionFlow).toBeTypeOf("function");
    const flow = getHomeSuggestionFlow!("unblock", "zh-CN");

    expect(flow.prefix).toBe("帮我找到");
    expect(flow.options).toHaveLength(4);
    expect(flow.options.map((option) => option.slotLabel)).toEqual([
      "当前任务",
      "当前困境",
      "停滞项目",
      "技术问题",
    ]);
    expect(flow.options[0]?.template).toEqual({
      before: "帮我找到",
      slotLabel: "当前任务",
      after: "继续推进还缺的信息",
    });
  });

  it("uses structured fields instead of bracket characters", async () => {
    const getHomeSuggestionFlow = await loadFlow();
    expect(getHomeSuggestionFlow).toBeTypeOf("function");
    const kinds = ["understand", "shape", "refine", "unblock"] as const;

    for (const kind of kinds) {
      const english = getHomeSuggestionFlow!(kind, "en");
      const chinese = getHomeSuggestionFlow!(kind, "zh-CN");
      const englishCopy = english.options
        .flatMap((option) => [
          option.before,
          option.slotLabel,
          option.after,
          option.template.before,
          option.template.slotLabel,
          option.template.after,
        ])
        .join("");
      const chineseCopy = chinese.options
        .flatMap((option) => [
          option.before,
          option.slotLabel,
          option.after,
          option.template.before,
          option.template.slotLabel,
          option.template.after,
        ])
        .join("");
      expect(englishCopy).not.toMatch(/[\[\]]/);
      expect(chineseCopy).not.toMatch(/[【】]/);
      expect(english.options.every((option) => option.slotLabel.length > 0)).toBe(true);
      expect(chinese.options.every((option) => option.slotLabel.length > 0)).toBe(true);
    }
  });
});
