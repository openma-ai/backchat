import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "./fixtures";
import {
  ITEM08_EVIDENCE_ROOT,
  captureItem08Picker,
  type PickerId,
} from "./pr56-item08-evidence";

const pickers: PickerId[] = [
  "project",
  "workspace",
  "composer-host",
  "sidebar-host",
  "model",
];

test.describe("PR56 item 08 evidence", () => {
  test.setTimeout(600_000);

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
    const comment = `# PR56 item 08 — main vs PR picker evidence

Packed archive: \`pr56-evidence-item08.tar.gz\`

## Capture setup

- **Main:** \`origin/main\` built at \`/tmp/backchat-main\` (\`BACKCHAT_E2E_APP_ROOT\`)
- **PR:** branch head built at \`/workspace\`
- **Viewport:** 1280×800, light theme, English / 中文 via settings
- **Fixture:** shared seeds (\`picker-grid-a/b\`, \`workspace-fit-project\`); current project **Beta monorepo** before open

## Files per locale (\`en/\`, \`zh/\`)

For each picker (\`project\`, \`workspace\`, \`composer-host\`, \`sidebar-host\`, \`model\`):

| File | Content |
|------|---------|
| \`<picker>-<locale>-main.png\` | **origin/main** menu just opened; **solid** red/blue = measured main columns |
| \`<picker>-<locale>-pr.png\` | **PR** menu just opened; solid lines = PR measured columns |
| \`<picker>-<locale>-main-pr.png\` | Stitched **main \\| PR** (1px gutter), same window size |
| \`<picker>-<locale>.metrics.json\` | Column positions + open highlight counts |

## Grid lines

- **Red / blue (solid):** icon and text column for that build (from project-style rows where applicable).
- Main project rows on \`origin/main\` typically land near **icon ~17px, text ~41px** from the popover edge; PR uses the shared grouped-command mesh (see metrics JSON per shot).

## Main-only UI notes

- **Sidebar host:** \`origin/main\` has no \`sidebar-local-runtime-row\`; main half uses the **composer** runtime dropdown (only host surface on main). PR half uses the sidebar grouped host menu.
- **Model:** main uses \`DropdownMenuSubContent\`; PR uses \`GroupedCommandMenu\` (\`composer-select-menu-panel\`). Both shots are taken immediately after open/hover with the active model row focused/highlighted.

## Regression fixed

Project picker on PR binds cmdk highlight to \`commandValue\` again (not search query), restoring \`data-selected\` on the checked row at open (\`e2e/smoke.spec.ts:697\`).
`;
    await writeFile(join(ITEM08_EVIDENCE_ROOT, "comment.md"), comment, "utf8");
  });
});
