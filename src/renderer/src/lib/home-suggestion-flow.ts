import type { Locale } from "./i18n";

export type HomeSuggestionKind = "understand" | "shape" | "refine" | "unblock";

export type HomeSuggestionFlow = {
  prefix: string;
  options: HomeSuggestionOption[];
};

export type HomeSuggestionTemplate = {
  before: string;
  slotLabel: string;
  after: string;
};

export type HomeSuggestionPhase = "visible" | "choosing" | "dismissed";

export type HomeSuggestionEvent =
  | "select"
  | "back"
  | "template-selected"
  | "user-input"
  | "user-clear"
  | "reset";

export type ComposerSuggestionDraft = {
  id: number;
  text: string;
  template?: HomeSuggestionTemplate;
};

export function transitionHomeSuggestionPhase(
  phase: HomeSuggestionPhase,
  event: HomeSuggestionEvent,
): HomeSuggestionPhase {
  switch (event) {
    case "select":
      return phase === "dismissed" ? "dismissed" : "choosing";
    case "back":
    case "reset":
    case "user-clear":
      return "visible";
    case "template-selected":
    case "user-input":
      return "dismissed";
  }
}

export function serializeSuggestionTemplate(
  template: HomeSuggestionTemplate,
  slotValue: string,
): string {
  const value = slotValue.trim();
  if (!value) return "";
  return `${template.before}${value}${template.after}`.trim();
}

export function removeSuggestionTemplateSlot(
  template: HomeSuggestionTemplate,
  slotValue: string,
): { text: string; caret: number } {
  return {
    text: `${template.before}${slotValue}${template.after}`,
    caret: template.before.length + slotValue.length,
  };
}

export type HomeSuggestionOption = {
  before: string;
  slotLabel: string;
  after: string;
  template: HomeSuggestionTemplate;
};

type LocalizedTemplate = {
  before: string;
  slot: string;
  after: string;
};

type LocalizedFlow = {
  prefix: string;
  templates: readonly LocalizedTemplate[];
};

const FLOWS: Record<HomeSuggestionKind, Record<Locale, LocalizedFlow>> = {
  understand: {
    en: {
      prefix: "Help me understand",
      templates: [
        { before: "", slot: "topic", after: " in plain language" },
        { before: "the key points in ", slot: "document or notes", after: "" },
        { before: "how ", slot: "process", after: " works end to end" },
        { before: "the evidence behind ", slot: "two competing claims", after: "" },
      ],
    },
    "zh-CN": {
      prefix: "帮我理清",
      templates: [
        { before: "", slot: "主题", after: "，用通俗语言讲明白" },
        { before: "", slot: "文档或笔记", after: "里的关键点" },
        { before: "", slot: "流程", after: "从头到尾如何运作" },
        { before: "", slot: "两种矛盾说法", after: "背后的证据" },
      ],
    },
  },
  shape: {
    en: {
      prefix: "Help me shape",
      templates: [
        { before: "", slot: "idea", after: " into a concrete plan" },
        { before: "", slot: "decision", after: " with clear tradeoffs" },
        { before: "", slot: "scattered notes", after: " into an outline" },
        { before: "", slot: "goal", after: " into milestones and next steps" },
      ],
    },
    "zh-CN": {
      prefix: "帮我打磨",
      templates: [
        { before: "", slot: "想法", after: "，把它变成具体计划" },
        { before: "", slot: "决策", after: "，明确标准和取舍" },
        { before: "", slot: "零散笔记", after: "，整理成清晰提纲" },
        { before: "", slot: "目标", after: "，拆成里程碑和下一步" },
      ],
    },
  },
  refine: {
    en: {
      prefix: "Help me improve",
      templates: [
        { before: "", slot: "draft", after: " into a clear final version" },
        { before: "the structure of ", slot: "presentation or report", after: "" },
        { before: "", slot: "workflow", after: " with less friction" },
        { before: "", slot: "code change", after: " with focused tests" },
      ],
    },
    "zh-CN": {
      prefix: "帮我完善",
      templates: [
        { before: "", slot: "草稿", after: "，让最终版本更清楚" },
        { before: "", slot: "汇报或报告", after: "的结构" },
        { before: "", slot: "流程", after: "，减少步骤和阻力" },
        { before: "", slot: "代码改动", after: "，并补上聚焦测试" },
      ],
    },
  },
  unblock: {
    en: {
      prefix: "Help me find",
      templates: [
        { before: "what ", slot: "current task", after: " needs to move forward" },
        { before: "the safest choice in ", slot: "current dilemma", after: "" },
        { before: "three next actions for ", slot: "stalled project", after: "" },
        { before: "the earliest clue in ", slot: "technical issue", after: "" },
      ],
    },
    "zh-CN": {
      prefix: "帮我找到",
      templates: [
        { before: "", slot: "当前任务", after: "继续推进还缺的信息" },
        { before: "", slot: "当前困境", after: "里最稳妥的选择" },
        { before: "", slot: "停滞项目", after: "接下来的三个动作" },
        { before: "", slot: "技术问题", after: "最早的异常线索" },
      ],
    },
  },
};

export function getHomeSuggestionFlow(
  kind: HomeSuggestionKind,
  locale: Locale,
): HomeSuggestionFlow {
  const flow = FLOWS[kind][locale];
  const separator = locale === "zh-CN" ? "" : " ";
  return {
    prefix: flow.prefix,
    options: flow.templates.map((template) => ({
      before: template.before,
      slotLabel: template.slot,
      after: template.after,
      template: {
        before: `${flow.prefix}${separator}${template.before}`,
        slotLabel: template.slot,
        after: template.after,
      },
    })),
  };
}
