---
name: create-backchat-theme
description: Create, modify, or validate Backchat color-theme plugins and migrate frontend visual values into the semantic theme-token contract. Use when a user asks for a Backchat skin, theme, color scheme, editor-style appearance pack, theme preview, or tokenization work under openma-desktop.
---

# Create a Backchat theme

Build source-controlled `*.theme.ts` plugins that replace Backchat's complete
visual token set and may opt into the small, validated presentation contract.

## Establish context

1. Locate the Backchat package root containing `package.json` with
   `"name": "backchat"`.
2. Read `PRODUCT.md`, `src/renderer/src/lib/theme-plugin.ts`,
   `src/renderer/src/themes/THEME_SPEC.md`, and
   `src/renderer/src/themes/index.ts` completely.
3. Read [references/token-contract.md](references/token-contract.md) completely.
4. Inspect at least one existing theme and the Appearance settings page before
   choosing values. Preserve unrelated work in a dirty tree.

Treat `THEME_TOKEN_NAMES` as the live source of truth. If it differs from this
skill's reference or template, follow the code and update the skill resources
in the same change.

## Create a plugin

1. Choose a unique lowercase kebab-case id. Use a distinct product name; do not
   imply endorsement by another editor or vendor.
2. Add an assertion for the new id to
   `src/renderer/src/lib/theme-plugin.test.ts`, then run that test and confirm
   it fails because the plugin is absent.
3. Use [assets/theme.template.ts](assets/theme.template.ts) as the structural
   starting point. Create `src/renderer/src/themes/<id>.theme.ts` with a default
   export from `defineThemePlugin`.
4. Set `specVersion: THEME_SPEC_VERSION`, set `appearance` to exactly one of
   `light` or `dark`, and supply intentional
   values for every token in that one concrete theme. A `*.theme.ts` file is
   never a light/dark pair. If the user wants a family, create two independently
   selectable plugins such as `<id>-light.theme.ts` and `<id>-dark.theme.ts`.
5. Set the four preview colors to literal CSS colors that accurately represent
   the plugin. The settings card must remain readable in either app mode.
6. When images are requested, import bundled SVG, PNG, or WebP files from a
   theme-local asset folder and contribute them directly through `assets`.
   Use only the fixed slots documented in the token reference.
   Record asset provenance and do not copy unlicensed editor artwork.
   If the user wants a new raster backdrop and an image-generation skill is
   available, use it to create an original asset, move the selected output into
   the theme-local folder, and inspect it in the real UI before finishing.
7. Use the declarative `presentation` contract when requested:
   `homeHero` deliberately chooses the surface, width, and height;
   `homeMasthead` adds a badge; `homeSlogan` supplies localized title,
   subtitle, emphasis, position, and typography; `homeSuggestions` controls
   card order/count, localized labels/descriptions/prompts, row offset, width,
   and bounded geometry; and `homeComposer` controls its localized placeholder
   and width. Do not reuse a framed composition merely because another image
   theme uses one. Never implement these fields with injected CSS or React. Use
   `layout.sidebarWidth` only when the visual composition requires a wider
   navigation rail; valid values are 200–560 CSS pixels.
8. When matching a supplied reference, transcribe requested visible copy
   exactly, plan the hero boundary before generating artwork, and compare a
   screenshot at the reference aspect ratio. Treat the hero, cards, and
   composer as separate layout regions; do not bake live text or card frames
   into the raster background.

The registry discovers `*.theme.ts` eagerly. Do not edit the registry for an
ordinary new plugin.

## Maintain the boundary

- Put theme-dependent colors and shadows in the plugin, not `index.css`, JSX,
  or component-specific selectors.
- Put images in declared asset slots. Do not inject arbitrary CSS, HTML, React
  components, remote trackers, or behavior from a visual theme.
- Keep interaction, accessibility, and responsive behavior shared. Layout
  changes are limited to the bounded v1 fields documented in `THEME_SPEC.md`.
- Use semantic roles: `danger` is an error state, not a decorative accent;
  `brand` is for focus, primary action, and selection.
- Keep each plugin bound to one appearance. Settings store separate preferred
  light and dark ids; `system` switches between those selections at runtime.
- When adding a new token, update `THEME_TOKEN_NAMES`, every existing plugin,
  Tailwind aliases or CSS consumers, the contract tests, this reference, and
  the template together.

## Verify

Run from the Backchat package root:

```bash
pnpm vitest run src/renderer/src/lib/theme-plugin.test.ts src/main/theme-token-contract.test.ts
pnpm typecheck
pnpm build
```

Then inspect Settings → Appearance in both modes. Verify selection persistence,
system-mode switching, terminal remounting, MCP/visualization surfaces, visible
keyboard focus, and WCAG AA text contrast. Fix the plugin rather than weakening
the completeness tests.
