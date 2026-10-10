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

test.describe("PR56 item 08 evidence v3", () => {
  test.setTimeout(1_200_000);

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
    const comment = `# PR56 item 08 evidence (v3)

Archive: \`pr56-evidence-item08-v3.tar.gz\`

## Intentional PR change (not main parity)

On **open**, PR keeps the **checkmark only** on the current row (no gray wash). \`origin/main\` still paints the 8% fg wash on the \`data-selected\` current row. Hover and arrow keys move the wash on both; see \`highlight-token.md\`.

## Capture hygiene

- \`*-open-*\`: menu just opened — **no ArrowDown/Up** (autofocus only).
- \`*-roving-*\`: one \`ArrowDown\` after open to show keyboard wash on the focused row.
- Identical fixture: \`e2e/pr56-item08-fixture.ts\` (icons, project order, \`item08-evidence-model\` session id).
- Stitched PNGs use the **same buffers** as standalone \`-main-\` / \`-pr-\` files from one capture pass per phase.
- Sidebar-host main half: N/A plate with **same caption height** as PR (800px + strip); stitched halves padded to equal height.
- Main model panel: \`DropdownMenuSubContent\` (no cmdk search); PR model: \`GroupedCommandMenu\`.

Regenerate:

\`\`\`bash
pnpm build && pnpm --dir /tmp/backchat-main build
pnpm exec playwright test e2e/pr56-item08-evidence.spec.ts
tar -czf /opt/cursor/artifacts/pr56-evidence-item08-v3.tar.gz -C /opt/cursor/artifacts pr56-evidence-item08-v3
\`\`\`
`;
    await writeFile(join(ITEM08_EVIDENCE_ROOT, "comment.md"), comment, "utf8");
  });
});
