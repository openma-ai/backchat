import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "./fixtures";
import {
  ITEM08_EVIDENCE_ROOT,
  captureItem08Picker,
  writeHighlightTokenDoc,
  type PickerId,
} from "./pr56-item08-evidence";

const pickers: PickerId[] = [
  "project",
  "workspace",
  "composer-host",
  "sidebar-host",
  "model",
];

test.describe("PR56 item 08 evidence v2", () => {
  test.setTimeout(900_000);

  test("highlight token doc", async () => {
    await writeHighlightTokenDoc(ITEM08_EVIDENCE_ROOT);
  });

  for (const language of ["en", "zh-CN"] as const) {
    for (const picker of pickers) {
      test(`${picker} ${language}`, async () => {
        const localeDir = join(
          ITEM08_EVIDENCE_ROOT,
          language === "zh-CN" ? "zh" : "en",
        );
        await captureItem08Picker(picker, language, localeDir);
      });
    }
  }

  test("write comment.md", async () => {
    const comment = `# PR56 item 08 evidence (v2)

Archive: \`pr56-evidence-item08-v2.tar.gz\`

## Capture

- Full **viewport** screenshots (1280×800; sidebar-host PR uses 1280×960), not popover crops.
- Caption strip on every half: build SHA (\`origin/main\` vs PR), picker, locale, dimensions.
- Stitched \`*-main-pr-<mainSha>-vs-<prSha>.png\` with dual-SHA footer.
- Grid lines at **ink** left edges (SVG path / text glyph bounds), viewport coordinates.
- Electron window focused before paint; menu search focused + arrow keys to settle roving state.
- **Sidebar host:** main half is an explicit **N/A** plate (no sidebar host on \`origin/main\`); see \`composer-host\` for closest main surface.
- **Model:** submenu panel only (\`composer-select-menu-panel\` / \`dropdown-menu-sub-content\`), not parent harness menu.
- Open highlight policy: \`highlight-token.md\` (checkmark-only for checked rows; shared \`--control-bg-hover\` token).

Regenerate:

\`\`\`bash
pnpm build
pnpm --dir /tmp/backchat-main build
pnpm exec playwright test e2e/pr56-item08-evidence.spec.ts
tar -czf /opt/cursor/artifacts/pr56-evidence-item08-v2.tar.gz -C /opt/cursor/artifacts pr56-evidence-item08-v2
\`\`\`
`;
    await writeFile(join(ITEM08_EVIDENCE_ROOT, "comment.md"), comment, "utf8");
  });
});
