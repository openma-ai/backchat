import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PromptAttachment } from "@shared/session-events.js";
import type { AcpAvailableCommand } from "@/lib/session-store";
import {
  AttachmentPreviewStrip,
  SkillCommandChip,
  SuggestionTemplateEditor,
} from "./ComposerContentParts";

function attachment(
  overrides: Partial<PromptAttachment> & Pick<PromptAttachment, "id" | "name">,
): PromptAttachment {
  return {
    path: `/tmp/${overrides.name}`,
    uri: `file:///tmp/${overrides.name}`,
    kind: "file",
    size: 12,
    ...overrides,
  };
}

describe("SuggestionTemplateEditor", () => {
  it("renders the template copy around an editable aligned slot", () => {
    const html = renderToStaticMarkup(
      <SuggestionTemplateEditor
        inputRef={createRef<HTMLInputElement>()}
        template={{
          before: "Shape ",
          slotLabel: "idea",
          after: " into a plan",
        }}
        value="launch"
        disabled={false}
        onChange={() => undefined}
        onRemove={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(html).toContain("Shape ");
    expect(html).toContain('aria-label="idea"');
    expect(html).toContain('value="launch"');
    expect(html).toContain(" into a plan");
    expect(html).toContain("items-baseline");
    expect(html).toContain('aria-label="Remove template field"');
  });

  it("focuses the active template slot without changing its alignment", async () => {
    const source = await import("./ComposerContentParts?raw").then(
      (module) => module.default as string,
    );

    expect(source).toContain("useLayoutEffect");
    expect(source).toContain("focus({ preventScroll: true })");
    expect(source).toContain("items-baseline");
    expect(source).not.toContain("items-center gap-y-2");
    expect(source).toContain("leading-7");
  });
});

describe("AttachmentPreviewStrip", () => {
  it("hides browser screenshots while keeping ordinary attachments removable", () => {
    const html = renderToStaticMarkup(
      <AttachmentPreviewStrip
        attachments={[
          attachment({ id: "browser", name: "browser-shot.png" }),
          attachment({ id: "notes", name: "notes.md" }),
        ]}
        browserScreenshotNames={new Set(["browser-shot.png"])}
        onRemove={() => undefined}
      />,
    );

    expect(html).not.toContain("browser-shot.png");
    expect(html).toContain("notes.md");
    expect(html).toContain('aria-label="Remove notes.md"');
    expect(html).toContain(">md<");
  });
});

describe("SkillCommandChip", () => {
  it("presents a selected skill as a removable command chip", () => {
    const command = {
      name: "skill:review",
      description: "Review the current changes",
    } as AcpAvailableCommand;

    const html = renderToStaticMarkup(
      <SkillCommandChip command={command} onRemove={() => undefined} />,
    );

    expect(html).toContain('aria-label="Skill Review"');
    expect(html).toContain('title="Remove skill"');
    expect(html).toContain(">Review<");
  });
});
