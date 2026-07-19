# Backchat Theme Plugin Spec v1

Status: stable built-in contract
Runtime constant: `THEME_SPEC_VERSION = 1`
Authoritative schema: `src/renderer/src/lib/theme-plugin.ts`

## Recognition

Backchat recognizes a file as a theme plugin when all of the following are true:

1. It is bundled as `src/renderer/src/themes/<id>.theme.ts` and has a default export.
2. The export was accepted by `defineThemePlugin`.
3. `specVersion` is exactly `1`. Unknown versions fail closed; the runtime does
   not guess or silently downgrade them.
4. `id` is unique lowercase kebab-case and the plugin contributes exactly one
   `appearance`: `light` or `dark`.
5. Every name in `THEME_TOKEN_NAMES` has a non-empty CSS value.
6. Optional geometry, localized copy, and suggestion declarations satisfy the
   bounds below.

The settings store selects light and dark plugin ids independently. `system`
mode switches between those two selected plugins; a single plugin is never a
light/dark pair.

## Required fields

```ts
interface ThemePluginV1 {
  specVersion: 1;
  id: string;
  name: string;
  author: string;
  description: string;
  appearance: "light" | "dark";
  preview: {
    background: string;
    surface: string;
    foreground: string;
    accent: string;
  };
  tokens: Record<ThemeTokenName, string>;
  assets?: Partial<Record<ThemeAssetSlot, string>>;
  layout?: { sidebarWidth?: number };
  presentation?: ThemePresentationV1;
}
```

Preview values are literal CSS colors used by Appearance. Tokens are complete
CSS custom-property values without a trailing semicolon.

## Declarative presentation

Presentation is data, never executable code:

```ts
type LocalizedText = string | { en: string; "zh-CN": string };

interface ThemePresentationV1 {
  homeHero?: {
    surface?: "framed" | "flush";
    width?: "content" | "bleed";
    height?: number; // 240..720
  };
  homeMasthead?: {
    icon?: string;
    title: string;
    subtitle?: string;
  };
  homeSlogan?: {
    text: LocalizedText;
    subtitle?: LocalizedText;
    emphasis?: LocalizedText;
    horizontal?: "left" | "center" | "right";
    vertical?: "top" | "center" | "bottom";
    fontFamily?: "display" | "ui";
    fontSize?: number;   // 20..72
    fontWeight?: number; // 400..800
  };
  homeSuggestions?: {
    width?: "inset" | "composer" | "wide";
    offsetY?: number; // -180..80
    items?: Array<{
      kind: "understand" | "shape" | "refine" | "unblock";
      label?: LocalizedText;
      description?: LocalizedText;
      prompt?: LocalizedText;
    }>;
    card?: {
      minHeight?: number;    // 80..320
      borderRadius?: number; // 0..40
      padding?: number;      // 8..56
      iconSize?: number;     // 16..96
      gap?: number;          // 0..64
      align?: "start" | "center";
    };
  };
  homeComposer?: {
    placeholder?: LocalizedText;
    width?: number; // 480..1120
  };
}
```

When `items` is omitted, Backchat renders the four product defaults. When it is
present, its order and length define the rendered cards. A suggestion kind may
appear at most once. Omitted labels and prompts fall back to the product copy.
Localized objects must contain non-empty `en` and `zh-CN` values. The optional
emphasis must be an exact substring of the localized title to receive accent
color; otherwise the title remains intact and unaccented.

`homeHero.surface` controls hierarchy rather than decoration: `framed` renders
an inset bordered canvas for collage-like skins, while `flush` renders the hero
as an unframed image plane. Image-led themes must choose deliberately instead
of inheriting another skin's composition. `width: "bleed"` removes the normal
home inset and spans the center pane; `"content"` keeps the bounded home stage.

`inset` aligns the card row with the tangent points of the composer corners;
`composer` uses the full composer width; `wide` may expand to the bounded home
stage. `offsetY: 0` begins the cards at the hero boundary; negative values
overlap it. `homeComposer` changes only empty-state width and placeholder.
Responsive wrapping and keyboard behavior remain app-owned.

## Assets

Assets are bundled URLs imported through Vite. v1 exposes only these fixed
slots:

- app and shell: `app-background`, `sidebar-background`, `empty-state`
- home: `home-hero-background`, `home-corner-decoration`
- per suggestion kind: `suggestion-<kind>-icon` and
  `suggestion-<kind>-background`

Missing slots are reset to `none` on every switch. Themes cannot inject remote
trackers, arbitrary CSS, HTML, React components, JavaScript, event handlers, or
new interactive panels. This is the compatibility and security boundary that
allows a skin to be installed and switched like an editor color theme.

## Geometry and compatibility

- `layout.sidebarWidth`: 200..560 CSS pixels.
- `homeHero.height`: 240..720 CSS pixels.
- `homeSlogan.fontSize`: 20..72; `fontWeight`: 400..800.
- `homeSuggestions.offsetY`: -180..80 CSS pixels.
- `homeComposer.width`: 480..1120 CSS pixels.
- Suggestion values outside their declared ranges are rejected.
- Core interaction, focus order, accessible names, responsive behavior, and
  composer behavior are not replaceable by v1.
- Adding a required token or a new executable capability requires a new spec
  version or a backwards-compatible optional field plus updated contract tests.
- A plugin written for a future version is rejected with an explicit error.

## Minimal example

```ts
export default defineThemePlugin({
  specVersion: THEME_SPEC_VERSION,
  id: "example-light",
  name: "Example Light",
  author: "Example",
  description: "A complete light theme.",
  appearance: "light",
  preview: { background: "#fff", surface: "#f5f5f5", foreground: "#222", accent: "#c33" },
  tokens,
  presentation: {
    homeHero: { surface: "flush", width: "bleed", height: 384 },
    homeSlogan: {
      text: { en: "Make the next move.", "zh-CN": "迈出下一步。" },
      subtitle: { en: "A supporting line.", "zh-CN": "一行说明。" },
      horizontal: "left",
      vertical: "top",
      fontFamily: "ui",
      fontSize: 48,
      fontWeight: 700,
    },
    homeSuggestions: {
      width: "inset",
      offsetY: 0,
      items: [{
        kind: "shape",
        label: { en: "Build", "zh-CN": "构建" },
        description: { en: "Write code", "zh-CN": "编写代码" },
      }],
      card: { minHeight: 120, iconSize: 40, gap: 12, align: "start" },
    },
    homeComposer: {
      placeholder: { en: "Type freely.", "zh-CN": "随心输入。" },
      width: 840,
    },
  },
});
```
