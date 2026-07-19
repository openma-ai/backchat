import { describe, expect, it } from "vitest";

import {
  buildComposerSubmitText,
  canSubmitComposer,
  deriveChatLabel,
  derivePromptDisplayText,
  resolveComposerEmptyBackspace,
  resolveComposerKeyAction,
} from "./composer-prompt";
import type { PromptAttachment } from "@shared/session-events.js";

const imageAttachment: PromptAttachment = {
  id: "attachment-1",
  name: "screenshot.png",
  path: "/tmp/screenshot.png",
  uri: "file:///tmp/screenshot.png",
  kind: "image",
  mimeType: "image/png",
  size: 10,
};

describe("composer prompt presentation", () => {
  it("builds template and skill command text exactly as the composer submits it", () => {
    expect(buildComposerSubmitText({
      text: "ignored while a template is active",
      suggestionTemplate: {
        before: "Help me shape ",
        slotLabel: "idea",
        after: " into a plan",
      },
      suggestionSlotValue: "a launch",
      selectedSkillCommand: { name: "skill:review" },
    })).toBe("Help me shape a launch into a plan");

    expect(buildComposerSubmitText({
      text: "focus on regressions",
      selectedSkillCommand: { name: "skill:review" },
    })).toBe("/skill:review focus on regressions");

    expect(buildComposerSubmitText({
      text: "   ",
      selectedSkillCommand: { name: "skill:review" },
    })).toBe("/skill:review");
  });

  it("resolves empty Backspace removal in visual stack order", () => {
    expect(resolveComposerEmptyBackspace({
      key: "Backspace",
      text: "",
      hasSelectedSkill: true,
      attachmentCount: 2,
      annotationCount: 1,
    })).toBe("skill");
    expect(resolveComposerEmptyBackspace({
      key: "Backspace",
      text: "",
      hasSelectedSkill: false,
      attachmentCount: 2,
      annotationCount: 1,
    })).toBe("attachment");
    expect(resolveComposerEmptyBackspace({
      key: "Backspace",
      text: "",
      hasSelectedSkill: false,
      attachmentCount: 0,
      annotationCount: 1,
    })).toBe("annotation");
    expect(resolveComposerEmptyBackspace({
      key: "Backspace",
      text: " ",
      hasSelectedSkill: true,
      attachmentCount: 2,
      annotationCount: 1,
    })).toBeNull();
    expect(resolveComposerEmptyBackspace({
      key: "Delete",
      text: "",
      hasSelectedSkill: true,
      attachmentCount: 2,
      annotationCount: 1,
    })).toBeNull();
  });

  it("routes slash-picker keys before ordinary composer submission", () => {
    const base = {
      text: "/comp",
      hasSelectedSkill: false,
      attachmentCount: 0,
      annotationCount: 0,
      slashPickerOpen: true,
      hasSlashSelection: true,
      shiftKey: false,
      isComposing: false,
    };

    expect(resolveComposerKeyAction({ ...base, key: "ArrowDown" }))
      .toBe("slash-next");
    expect(resolveComposerKeyAction({ ...base, key: "ArrowUp" }))
      .toBe("slash-previous");
    expect(resolveComposerKeyAction({ ...base, key: "Enter" }))
      .toBe("slash-pick");
    expect(resolveComposerKeyAction({ ...base, key: "Tab" }))
      .toBe("slash-pick");
    expect(resolveComposerKeyAction({ ...base, key: "Escape" }))
      .toBe("slash-dismiss");
    expect(resolveComposerKeyAction({
      ...base,
      key: "Backspace",
      text: "",
      attachmentCount: 1,
      slashPickerOpen: false,
      hasSlashSelection: false,
    })).toBe("remove-attachment");
  });

  it("does not submit Shift+Enter or an IME composition", () => {
    const base = {
      key: "Enter",
      text: "hello",
      hasSelectedSkill: false,
      attachmentCount: 0,
      annotationCount: 0,
      slashPickerOpen: false,
      hasSlashSelection: false,
    };

    expect(resolveComposerKeyAction({
      ...base,
      shiftKey: true,
      isComposing: false,
    })).toBeNull();
    expect(resolveComposerKeyAction({
      ...base,
      shiftKey: false,
      isComposing: true,
    })).toBeNull();
    expect(resolveComposerKeyAction({
      ...base,
      shiftKey: false,
      isComposing: false,
    })).toBe("submit");
  });

  it("falls through a stale slash selection without trapping Enter or Tab", () => {
    const base = {
      text: "/missing",
      hasSelectedSkill: false,
      attachmentCount: 0,
      annotationCount: 0,
      slashPickerOpen: true,
      hasSlashSelection: false,
      shiftKey: false,
      isComposing: false,
    };

    expect(resolveComposerKeyAction({ ...base, key: "Enter" })).toBe("submit");
    expect(resolveComposerKeyAction({ ...base, key: "Tab" })).toBeNull();
  });

  it("submits text, attachment-only, or annotation-only input unless disabled", () => {
    expect(canSubmitComposer({
      text: "hello",
      disabled: false,
    })).toBe(true);
    expect(canSubmitComposer({
      text: "",
      attachments: [imageAttachment],
      disabled: false,
    })).toBe(true);
    expect(canSubmitComposer({
      text: "",
      annotations: [{
        id: "annotation-1",
        source_session_id: "session-1",
        source_turn_id: "turn-1",
        text: "selected response",
      }],
      disabled: false,
    })).toBe(true);
    expect(canSubmitComposer({
      text: "hello",
      disabled: true,
    })).toBe(false);
  });

  it("uses visible placeholders for prompts that only contain context", () => {
    expect(derivePromptDisplayText("", [], 1)).toBe("[1 annotation]");
    expect(derivePromptDisplayText("", [], 2)).toBe("[2 annotations]");
    expect(derivePromptDisplayText("", [imageAttachment])).toBe(
      "[Attached image: screenshot.png]",
    );
    expect(derivePromptDisplayText("", [
      imageAttachment,
      { ...imageAttachment, id: "attachment-2", name: "notes.md", kind: "file" },
    ])).toBe("[Attached 2 files: screenshot.png, notes.md]");
    expect(derivePromptDisplayText("Explain this", [imageAttachment], 1)).toBe(
      "Explain this",
    );
  });

  it("derives a stable single-line sidebar label with a hard length cap", () => {
    expect(deriveChatLabel("  First line\nSecond line  ")).toBe("First line");
    expect(deriveChatLabel("x".repeat(45))).toBe(`${"x".repeat(39)}…`);
    expect(deriveChatLabel("", new Date(2026, 0, 1, 9, 7))).toBe(
      "Chat · 09:07",
    );
  });
});
