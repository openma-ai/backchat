# Backchat theme token contract

The runtime applies one complete token map to `<html>` and exposes the active
selection as `data-theme` and `data-theme-mode`. Tailwind and shadcn aliases in
`src/renderer/src/styles/index.css` consume these values.

## Core roles

- `brand`, `brand-hover`, `brand-subtle`, `brand-fg`: primary action, focus,
  selected state, and legible content placed on the brand color.
- `bg`: main content surface.
- `bg-sidebar`: app stage and navigation surface.
- `bg-surface`: raised controls, menus, and secondary panels.
- `bg-bubble`: messages and stronger selection surfaces.
- `bg-overlay`: modal backdrop with alpha.
- `fg`: primary text.
- `fg-muted`: secondary text and descriptions; keep at least 4.5:1 on every
  background where it is used.
- `fg-subtle`: compact metadata and placeholders; it also needs 4.5:1 because
  Backchat uses it below large-text sizes.
- `border`, `border-strong`: ordinary and emphasized separators.

## State roles

- `success` / `success-subtle`: completed or healthy states.
- `warning` / `warning-subtle`: caution and pending attention.
- `danger` / `danger-subtle`: destructive action and error states.
- `info` / `info-subtle`: neutral informational state.
- `accent-violet` / `accent-violet-subtle`: the secondary categorical accent.
- `ring`: keyboard focus; normally references `var(--brand)`.

For each `*-subtle` pair, verify the strong role remains readable when used as
foreground on its subtle surface. Never communicate state by color alone.

## Depth roles

- `shadow-md`, `shadow-sm`: generic elevated surfaces.
- `shadow-card-soft`, `shadow-card-press`: resting and engaged cards.
- `shadow-input-rest`: input elevation.
- `shadow-chip-press`: active segmented controls.
- `shadow-pip`: picture-in-picture interactive surfaces.

Values are complete CSS custom-property values without a trailing semicolon.
Use OKLCH for authored colors where practical. Alpha colors, `color-mix()`,
`var()` references, and multi-layer shadows are supported.

## Contrast and palette checks

- Normal text: at least 4.5:1.
- Large text and non-text UI boundaries: at least 3:1.
- `brand-fg` on `brand`: at least 4.5:1 because primary buttons use compact
  text.
- Focus rings: visible against `bg`, `bg-sidebar`, and `bg-surface`.
- Light and dark elevation ladders must remain ordered; adjacent surfaces need
  enough difference to be perceived without adding arbitrary borders.

The authoritative token list is always `THEME_TOKEN_NAMES` in
`src/renderer/src/lib/theme-plugin.ts`.

## Image contribution slots

Each concrete theme plugin may provide bundled image URLs:

- `app-background`: subdued full-window stage image, painted beneath app
  surfaces with Backchat-owned opacity and cover behavior.
- `sidebar-background`: image layer on the left navigation glass surface.
- `empty-state`: contained illustration shown above the empty-chat heading.
- `home-hero-background`: wide home-page hero artwork behind the live heading;
  compose subjects toward the right and reserve quiet space on the left.
- `home-corner-decoration`: optional portrait/decorative artwork presented in
  a small polaroid frame at the lower-right of an image-led home screen.
- `suggestion-understand-icon` / `suggestion-understand-background`: artwork
  for the sense-making starter card.
- `suggestion-shape-icon` / `suggestion-shape-background`: artwork for the
  idea-shaping starter card.
- `suggestion-refine-icon` / `suggestion-refine-background`: artwork for the
  improve-what-I-have starter card.
- `suggestion-unblock-icon` / `suggestion-unblock-background`: artwork for the
  get-unstuck starter card.

Suggestion slots are independent: themes may replace one icon or card
background without replacing the other seven. When an icon is absent,
Backchat renders its built-in semantic line icon. `presentation.homeSuggestions`
may declaratively replace card order, localized label, description, prompt,
offset, width, and bounded geometry; it cannot replace event handling or inject
a component.

Import assets through Vite and use the resulting URL:

```ts
import background from "./assets/background.webp";

assets: {
  "app-background": background,
  "home-hero-background": homeHero,
  "home-corner-decoration": cornerPortrait,
  "suggestion-shape-icon": shapeIcon,
  "suggestion-shape-background": shapeCardBackground,
}
```

Missing slots resolve to `none` on every switch, so images cannot leak from the
previous theme. Responsive placement and component behavior remain app-owned.

## Optional presentation and shell geometry

An image-led theme may choose a framed inset or flush hero plane, then add a
decorative masthead, localized slogan, and bounded starter-card presentation:

```ts
presentation: {
  homeHero: { surface: "flush", width: "bleed", height: 384 },
  homeMasthead: {
    icon: "🍓",
    title: "A personal theme title",
    subtitle: "Backchat Desktop · Theme Name",
  },
  homeSlogan: {
    text: { en: "Make the next move.", "zh-CN": "迈出下一步。" },
    subtitle: { en: "A supporting line.", "zh-CN": "一行说明。" },
    emphasis: { en: "next", "zh-CN": "下一步" },
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
        description: { en: "Write code and applications", "zh-CN": "编写代码与应用" },
        prompt: { en: "Help me build this", "zh-CN": "帮我构建这个想法" },
      },
    ],
    card: { minHeight: 120, borderRadius: 18, padding: 18, iconSize: 40, gap: 12, align: "start" },
  },
  homeComposer: {
    placeholder: { en: "Type freely.", "zh-CN": "随心输入。" },
    width: 840,
  },
},
```

`homeHero.width: "bleed"` spans the center pane; `"content"` keeps the normal
home inset. Height is 240–720 CSS pixels. Slogan size is 20–72 and weight is
400–800. Suggestion offset is -180–80; negative values overlap the hero.
Composer width is 480–1120.

Themes that need a wider visual navigation column may declare
`layout.sidebarWidth`. The runtime validates a range of 200–560 CSS pixels and
returns to the product default when the next theme omits it.

The complete recognition, range, localization, and compatibility rules live in
`src/renderer/src/themes/THEME_SPEC.md`. The current accepted version is exactly
`specVersion: 1`; unsupported versions fail closed.
