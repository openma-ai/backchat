import {
  THEME_SPEC_VERSION,
  defineThemePlugin,
  type ThemeTokens,
} from "@/lib/theme-plugin";
import heroUrl from "./assets/red-horizon-hero.png";
import sidebarUrl from "./assets/red-horizon-sidebar.svg";
import suggestionBackgroundUrl from "./assets/red-horizon-suggestion-background.svg";
import understandIconUrl from "./assets/red-horizon-suggestion-understand.svg";
import shapeIconUrl from "./assets/red-horizon-suggestion-shape.svg";
import refineIconUrl from "./assets/red-horizon-suggestion-refine.svg";
import unblockIconUrl from "./assets/red-horizon-suggestion-unblock.svg";

const tokens: ThemeTokens = {
  brand: "oklch(0.56 0.22 28)",
  "brand-hover": "oklch(0.49 0.23 28)",
  "brand-subtle": "oklch(0.96 0.035 28)",
  "brand-fg": "#ffffff",
  bg: "oklch(0.992 0.008 45)",
  "bg-sidebar": "oklch(0.974 0.018 34)",
  "bg-surface": "oklch(0.985 0.012 38)",
  "bg-bubble": "oklch(0.95 0.028 31)",
  "bg-overlay": "oklch(0.25 0.03 28 / 0.30)",
  fg: "oklch(0.22 0.025 27)",
  "fg-muted": "oklch(0.43 0.03 28)",
  "fg-subtle": "oklch(0.50 0.025 28)",
  border: "oklch(0.89 0.022 31)",
  "border-strong": "oklch(0.79 0.045 29)",
  success: "oklch(0.54 0.15 145)",
  "success-subtle": "oklch(0.95 0.04 145)",
  warning: "oklch(0.64 0.16 70)",
  "warning-subtle": "oklch(0.96 0.04 70)",
  danger: "oklch(0.53 0.22 27)",
  "danger-subtle": "oklch(0.95 0.045 27)",
  info: "oklch(0.54 0.16 250)",
  "info-subtle": "oklch(0.95 0.03 250)",
  "accent-violet": "oklch(0.55 0.18 305)",
  "accent-violet-subtle": "oklch(0.95 0.035 305)",
  "shadow-md": "0 12px 28px -14px rgb(134 38 28 / 0.22)",
  "shadow-sm": "0 2px 6px -3px rgb(134 38 28 / 0.14)",
  "shadow-card-soft": "0 16px 34px -22px rgb(134 38 28 / 0.25), 0 3px 8px -5px rgb(134 38 28 / 0.12)",
  "shadow-card-press": "0 4px 8px -6px rgb(134 38 28 / 0.20), 0 9px 17px -13px rgb(134 38 28 / 0.18)",
  "shadow-input-rest": "0 2px 7px -5px rgb(134 38 28 / 0.16), 0 9px 20px -16px rgb(134 38 28 / 0.18)",
  "shadow-chip-press": "0 2px 5px -4px rgb(134 38 28 / 0.18)",
  "shadow-pip": "0 24px 56px -24px rgb(78 28 22 / 0.34), 0 6px 16px -9px rgb(78 28 22 / 0.22)",
  ring: "var(--brand)",
};

export default defineThemePlugin({
  specVersion: THEME_SPEC_VERSION,
  id: "red-horizon-light",
  name: "Red Horizon Light",
  author: "Backchat",
  description: "A luminous cream-and-crimson workspace looking toward a shared horizon.",
  appearance: "light",
  preview: {
    background: "#fff9f5",
    surface: "#fff0eb",
    foreground: "#342421",
    accent: "#d92f26",
  },
  tokens,
  layout: {
    sidebarWidth: 240,
  },
  presentation: {
    homeHero: {
      surface: "flush",
      width: "bleed",
      height: 384,
    },
    homeSlogan: {
      text: {
        en: "OpenAI is the people's AI.",
        "zh-CN": "OpenAI 是人民的 AI。",
      },
      subtitle: {
        en: "Using advanced tools to create more possibilities for everyone.",
        "zh-CN": "用先进的工具，为每一个人创造更多可能。",
      },
      emphasis: {
        en: "people's",
        "zh-CN": "人民",
      },
      horizontal: "left",
      vertical: "top",
      fontFamily: "ui",
      fontSize: 48,
      fontWeight: 700,
    },
    homeSuggestions: {
      width: "inset",
      offsetY: 0,
      items: [
        {
          kind: "shape",
          label: { en: "Build", "zh-CN": "构建" },
          description: {
            en: "Write code and applications",
            "zh-CN": "编写代码与应用",
          },
          prompt: { en: "Help me build this into something real", "zh-CN": "帮我把这个想法构建成真正可用的东西" },
        },
        {
          kind: "understand",
          label: { en: "Analyze", "zh-CN": "分析" },
          description: {
            en: "Data analysis and insights",
            "zh-CN": "数据分析与洞察",
          },
          prompt: { en: "Analyze this and surface the key insight", "zh-CN": "分析这些内容，帮我找到关键洞察" },
        },
        {
          kind: "refine",
          label: { en: "Automate", "zh-CN": "自动化" },
          description: {
            en: "Agents and workflows",
            "zh-CN": "智能体与工作流",
          },
          prompt: { en: "Turn this repeated work into an automation", "zh-CN": "帮我把这项重复工作变成自动化流程" },
        },
        {
          kind: "unblock",
          label: { en: "Debug", "zh-CN": "调试" },
          description: {
            en: "Fix issues and optimize",
            "zh-CN": "修复问题与优化",
          },
          prompt: { en: "Debug this problem and propose the next fix", "zh-CN": "调试这个问题，并给出下一步修复方案" },
        },
      ],
      card: {
        minHeight: 140,
        borderRadius: 14,
        padding: 20,
        iconSize: 44,
        gap: 12,
        align: "center",
      },
    },
    homeComposer: {
      placeholder: {
        en: "Type freely. Codex will build the future with you.",
        "zh-CN": "随心输入，Codex 为你构建未来",
      },
      width: 840,
    },
  },
  assets: {
    "sidebar-background": sidebarUrl,
    "home-hero-background": heroUrl,
    "suggestion-understand-icon": understandIconUrl,
    "suggestion-understand-background": suggestionBackgroundUrl,
    "suggestion-shape-icon": shapeIconUrl,
    "suggestion-shape-background": suggestionBackgroundUrl,
    "suggestion-refine-icon": refineIconUrl,
    "suggestion-refine-background": suggestionBackgroundUrl,
    "suggestion-unblock-icon": unblockIconUrl,
    "suggestion-unblock-background": suggestionBackgroundUrl,
  },
});
