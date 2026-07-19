import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SlashCommandSection } from "@/lib/composer-slash-commands";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "chat.slashCommands": "Slash commands",
        "chat.commands": "Commands",
        "chat.skills": "Skills",
        "chat.moreSkills": "more skills",
      })[key] ?? key,
  }),
}));

import { ComposerSlashCommandMenu } from "./ComposerSlashCommandMenu";

describe("ComposerSlashCommandMenu", () => {
  it("renders grouped commands with one globally selected option", () => {
    const sections: SlashCommandSection[] = [
      {
        kind: "commands",
        hiddenCount: 0,
        commands: [
          {
            name: "compact",
            description: "Compact context",
          },
        ],
      },
      {
        kind: "skills",
        hiddenCount: 3,
        commands: [
          {
            name: "skill:review",
            description: "Review changes",
            input: { hint: "optional focus" },
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      <ComposerSlashCommandMenu
        sections={sections}
        selectedIndex={1}
        onHighlight={() => undefined}
        onPick={() => undefined}
      />,
    );

    expect(html).toContain('role="listbox"');
    expect(html).toContain(">Commands<");
    expect(html).toContain(">Skills<");
    expect(html).toContain(">/compact<");
    expect(html).toContain(">/skill:review<");
    expect(html).toContain("optional focus");
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain(">3<");
    expect(html).toContain(">more skills<");
  });
});
