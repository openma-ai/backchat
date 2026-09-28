# Desktop typography

Typography is defined at 100% Electron zoom. Window zoom is a user accessibility
control, not a replacement for design tokens. This is a product-specific scale
informed by Apple's macOS HIG; it is not an exact copy of every native text style.

Reference: https://developer.apple.com/design/human-interface-guidelines/typography

| Role | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| caption | 12 / 18 px | 400 | Status, timestamps, group labels, secondary tools |
| ui | 13 / 20 px | 400; 500 for task titles | Navigation, resource rows, toolbar titles |
| body | 14 / 22 px | 400 | Conversation and composer text |
| section | 15 / 24 px | 600 | Response headings |

Source: `--type-*` tokens in renderer styles; utilities: `text-caption`, `text-ui`,
`text-body`, `text-section`. Semantic heading levels remain intact even when
sharing a visual size. Avoid bold captions and arbitrary one-off font sizes in
these surfaces. Home artwork/hero type and code editors are separate roles.

Use foreground, muted foreground, and spacing for hierarchy before adding another
size. Do not shrink click targets to match smaller text. Test CJK and Latin text,
light/dark appearances, and user zoom independently of device pixel ratio.

## Automated audit

`pnpm exec playwright test e2e/task-resource-rail.spec.ts -g 'typography roles'`
checks computed sizes on navigation, task panel, status and response text.
`src/main/ui-zoom-contract.test.ts` checks the 100% launch baseline.
These checks cover the migrated chat shell, not every settings page or theme hero.

## Markdown

Settled and streaming Markdown share selectors and tokens:
- Paragraphs, lists and quotes: 14/22px, regular; thought text: 13/20px.
- H1–H2: 15/24px, semibold; H3–H6: 14/22px, semibold.
- Inline code, fenced code, tables: 13/20px. Inline code uses the surrounding line box.
- Heading levels remain semantic, with hierarchy conveyed through spacing as well as type.

The typography E2E checks real rendered headings, paragraphs, lists, quotes,
inline code, fenced code and table cells, including H5 fallback styles.
