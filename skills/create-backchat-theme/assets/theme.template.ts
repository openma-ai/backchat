import {
  THEME_SPEC_VERSION,
  defineThemePlugin,
  type ThemeTokens,
} from "@/lib/theme-plugin";

const tokens: ThemeTokens = {
  brand: "oklch(0.55 0.18 250)",
  "brand-hover": "oklch(0.49 0.18 250)",
  "brand-subtle": "oklch(0.96 0.03 250)",
  "brand-fg": "#ffffff",
  bg: "oklch(0.99 0.004 250)",
  "bg-sidebar": "oklch(0.95 0.008 250)",
  "bg-surface": "oklch(0.97 0.006 250)",
  "bg-bubble": "oklch(0.93 0.01 250)",
  "bg-overlay": "oklch(0 0 0 / 0.3)",
  fg: "oklch(0.20 0.015 250)",
  "fg-muted": "oklch(0.43 0.018 250)",
  "fg-subtle": "oklch(0.50 0.018 250)",
  border: "oklch(0.86 0.014 250)",
  "border-strong": "oklch(0.76 0.02 250)",
  success: "oklch(0.58 0.17 145)",
  "success-subtle": "oklch(0.96 0.04 145)",
  warning: "oklch(0.68 0.16 75)",
  "warning-subtle": "oklch(0.96 0.04 75)",
  danger: "oklch(0.57 0.21 25)",
  "danger-subtle": "oklch(0.96 0.04 25)",
  info: "oklch(0.55 0.16 250)",
  "info-subtle": "oklch(0.96 0.03 250)",
  "accent-violet": "oklch(0.55 0.19 300)",
  "accent-violet-subtle": "oklch(0.96 0.03 300)",
  "shadow-md": "0 4px 12px -4px rgb(0 0 0 / 0.12)",
  "shadow-sm": "0 1px 2px -1px rgb(0 0 0 / 0.08)",
  "shadow-card-soft": "0 8px 24px -12px rgb(0 0 0 / 0.10), 0 2px 6px -2px rgb(0 0 0 / 0.04)",
  "shadow-card-press": "0 2px 4px -2px rgb(0 0 0 / 0.08), 0 6px 12px -6px rgb(0 0 0 / 0.08)",
  "shadow-input-rest": "0 1px 2px -1px rgb(0 0 0 / 0.05), 0 4px 8px -6px rgb(0 0 0 / 0.06)",
  "shadow-chip-press": "0 1px 2px -1px rgb(0 0 0 / 0.08)",
  "shadow-pip": "0 18px 48px -18px rgb(0 0 0 / 0.28), 0 4px 14px -6px rgb(0 0 0 / 0.16)",
  ring: "var(--brand)",
};

export default defineThemePlugin({
  specVersion: THEME_SPEC_VERSION,
  id: "replace-me-light",
  name: "Replace Me Light",
  author: "Your Name",
  description: "Describe the intended working environment and visual character.",
  appearance: "light",
  preview: {
    background: "#f7f9fc",
    surface: "#e8edf5",
    foreground: "#202936",
    accent: "#3979c8",
  },
  tokens,
  // Optional, validated shell geometry. Omit to keep the product default.
  // layout: { sidebarWidth: 276 },
  // Optional, declarative home presentation. Both locales are required when
  // a localized object is used; omit card copy to keep product defaults.
  // presentation: {
  //   homeHero: { surface: "framed", width: "content", height: 420 },
  //   homeMasthead: {
  //     icon: "✦",
  //     title: "A personal theme title",
  //     subtitle: "Backchat Desktop · Theme Name",
  //   },
  //   homeSlogan: {
  //     text: { en: "Make the next move.", "zh-CN": "迈出下一步。" },
  //     subtitle: { en: "A supporting line.", "zh-CN": "一行说明。" },
  //     emphasis: { en: "next", "zh-CN": "下一步" },
  //     horizontal: "left",
  //     vertical: "center",
  //     fontFamily: "ui",
  //     fontSize: 48,
  //     fontWeight: 700,
  //   },
  //   homeSuggestions: {
  //     width: "inset",
  //     offsetY: 0,
  //     items: [
  //       {
  //         kind: "shape",
  //         label: { en: "Build", "zh-CN": "构建" },
  //         description: { en: "Write code and applications", "zh-CN": "编写代码与应用" },
  //         prompt: { en: "Help me build this", "zh-CN": "帮我构建这个想法" },
  //       },
  //     ],
  //     card: {
  //       minHeight: 120,
  //       borderRadius: 18,
  //       padding: 18,
  //       iconSize: 40,
  //       gap: 12,
  //       align: "start",
  //     },
  //   },
  //   homeComposer: {
  //     placeholder: { en: "Type freely.", "zh-CN": "随心输入。" },
  //     width: 840,
  //   },
  // },
  // Import a bundled asset above, then opt into fixed slots as needed:
  // assets: {
  //   "app-background": backgroundUrl,
  //   "home-hero-background": homeHeroUrl,
  //   "home-corner-decoration": cornerPortraitUrl,
  //   "suggestion-shape-icon": shapeIconUrl,
  //   "suggestion-shape-background": shapeCardBackgroundUrl,
  // },
});
