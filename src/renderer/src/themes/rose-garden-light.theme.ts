import { THEME_SPEC_VERSION, defineThemePlugin, type ThemeTokens } from "@/lib/theme-plugin";
import backgroundUrl from "./assets/rose-garden-background.svg";
import sidebarUrl from "./assets/rose-garden-sidebar.svg";
import portraitHeroUrl from "./assets/rose-garden-portrait-hero.png";
import suggestionBackgroundUrl from "./assets/rose-garden-suggestion-background.svg";
import understandIconUrl from "./assets/rose-garden-suggestion-understand.svg";
import shapeIconUrl from "./assets/rose-garden-suggestion-shape.svg";
import refineIconUrl from "./assets/rose-garden-suggestion-refine.svg";
import unblockIconUrl from "./assets/rose-garden-suggestion-unblock.svg";

const tokens: ThemeTokens = {
  brand: "oklch(0.60 0.16 8)",
  "brand-hover": "oklch(0.53 0.17 8)",
  "brand-subtle": "oklch(0.96 0.035 8)",
  "brand-fg": "#ffffff",
  bg: "oklch(0.985 0.012 30 / 0.88)",
  "bg-sidebar": "oklch(0.965 0.025 16 / 0.90)",
  "bg-surface": "oklch(0.975 0.018 22 / 0.94)",
  "bg-bubble": "oklch(0.945 0.035 10 / 0.94)",
  "bg-overlay": "oklch(0.28 0.03 8 / 0.28)",
  fg: "oklch(0.25 0.035 18)",
  "fg-muted": "oklch(0.43 0.045 12)",
  "fg-subtle": "oklch(0.49 0.052 10)",
  border: "oklch(0.86 0.045 9)",
  "border-strong": "oklch(0.74 0.075 8)",
  success: "oklch(0.54 0.14 145)",
  "success-subtle": "oklch(0.95 0.04 145)",
  warning: "oklch(0.62 0.14 75)",
  "warning-subtle": "oklch(0.96 0.04 75)",
  danger: "oklch(0.54 0.19 24)",
  "danger-subtle": "oklch(0.95 0.045 24)",
  info: "oklch(0.52 0.13 258)",
  "info-subtle": "oklch(0.95 0.03 258)",
  "accent-violet": "oklch(0.53 0.16 316)",
  "accent-violet-subtle": "oklch(0.95 0.035 316)",
  "shadow-md": "0 8px 22px -8px rgb(120 55 70 / 0.20)",
  "shadow-sm": "0 2px 6px -3px rgb(120 55 70 / 0.15)",
  "shadow-card-soft": "0 14px 34px -18px rgb(120 55 70 / 0.24), 0 3px 8px -4px rgb(120 55 70 / 0.12)",
  "shadow-card-press": "0 3px 7px -4px rgb(120 55 70 / 0.18), 0 8px 16px -10px rgb(120 55 70 / 0.16)",
  "shadow-input-rest": "0 2px 6px -4px rgb(120 55 70 / 0.16), 0 8px 18px -14px rgb(120 55 70 / 0.20)",
  "shadow-chip-press": "0 2px 5px -3px rgb(120 55 70 / 0.18)",
  "shadow-pip": "0 22px 52px -22px rgb(85 35 48 / 0.36), 0 6px 16px -8px rgb(85 35 48 / 0.22)",
  ring: "var(--brand)",
};

export default defineThemePlugin({
  specVersion: THEME_SPEC_VERSION,
  id: "rose-garden-light",
  name: "Rose Garden Light",
  author: "Backchat",
  description: "A soft cream-and-rose workspace with an original botanical backdrop.",
  appearance: "light",
  preview: {
    background: "#fff7f5",
    surface: "#f8e8e8",
    foreground: "#4c3033",
    accent: "#c85d79",
  },
  tokens,
  layout: {
    sidebarWidth: 276,
  },
  presentation: {
    homeHero: {
      surface: "framed",
    },
    homeMasthead: {
      icon: "🍓",
      title: "雨姐专属定制皮肤",
      subtitle: "OpenMA Desktop · Rose Garden",
    },
    homeSlogan: {
      text: {
        en: "What can I help with?",
        "zh-CN": "有什么可以帮你？",
      },
      horizontal: "left",
      vertical: "center",
    },
    homeSuggestions: {
      width: "inset",
      items: [
        {
          kind: "understand",
          label: { en: "Clarify one thing", "zh-CN": "理清一件事" },
          prompt: { en: "Help me understand this clearly", "zh-CN": "帮我把这件事理清楚" },
        },
        {
          kind: "shape",
          label: { en: "Polish an idea", "zh-CN": "打磨一个想法" },
          prompt: { en: "Help me turn this idea into a plan", "zh-CN": "帮我把这个想法打磨成可行方案" },
        },
        {
          kind: "refine",
          label: { en: "Improve my work", "zh-CN": "完善手头内容" },
          prompt: { en: "Help me improve what I am working on", "zh-CN": "帮我完善手头正在做的内容" },
        },
        {
          kind: "unblock",
          label: { en: "Find a way forward", "zh-CN": "帮我打开局面" },
          prompt: { en: "Help me find a practical next step", "zh-CN": "帮我找到一个能推进下去的办法" },
        },
      ],
      card: {
        minHeight: 148,
        borderRadius: 18,
        padding: 18,
        iconSize: 52,
        gap: 12,
        align: "center",
      },
    },
  },
  assets: {
    "app-background": backgroundUrl,
    "sidebar-background": sidebarUrl,
    "empty-state": understandIconUrl,
    "home-hero-background": portraitHeroUrl,
    "home-corner-decoration": portraitHeroUrl,
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
