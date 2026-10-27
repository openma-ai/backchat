import type {
  PromptAnnotation,
  PromptAttachment,
} from "@shared/session-events.js";
import {
  serializeSuggestionTemplate,
  type HomeSuggestionTemplate,
} from "./home-suggestion-flow";

export function buildComposerSubmitText({
  text,
  selectedSkillCommand,
  suggestionTemplate,
  suggestionSlotValue = "",
}: {
  text: string;
  selectedSkillCommand?: { name: string } | null;
  suggestionTemplate?: HomeSuggestionTemplate | null;
  suggestionSlotValue?: string;
}): string {
  if (suggestionTemplate) {
    return serializeSuggestionTemplate(
      suggestionTemplate,
      suggestionSlotValue,
    );
  }
  const body = text.trim();
  if (!selectedSkillCommand) return body;
  const commandText = `/${selectedSkillCommand.name}`;
  return body ? `${commandText} ${body}` : commandText;
}

export type ComposerEmptyBackspaceTarget =
  | "skill"
  | "session-reference"
  | "attachment"
  | "annotation";

export function resolveComposerEmptyBackspace({
  key,
  text,
  hasSelectedSkill,
  attachmentCount,
  annotationCount,
  sessionReferenceCount = 0,
}: {
  key: string;
  text: string;
  hasSelectedSkill: boolean;
  attachmentCount: number;
  annotationCount: number;
  sessionReferenceCount?: number;
}): ComposerEmptyBackspaceTarget | null {
  if (key !== "Backspace" || text.length > 0) return null;
  if (hasSelectedSkill) return "skill";
  if (sessionReferenceCount > 0) return "session-reference";
  if (attachmentCount > 0) return "attachment";
  if (annotationCount > 0) return "annotation";
  return null;
}

export type ComposerKeyAction =
  | "remove-skill"
  | "remove-session-reference"
  | "remove-attachment"
  | "remove-annotation"
  | "slash-next"
  | "slash-previous"
  | "slash-pick"
  | "slash-dismiss"
  | "slash-apply-hint"
  | "slash-dismiss-hint"
  | "queue"
  | "submit";

export function resolveComposerKeyAction({
  key,
  text,
  hasSelectedSkill,
  attachmentCount,
  annotationCount,
  sessionReferenceCount = 0,
  slashPickerOpen,
  hasSlashSelection,
  hasSlashInputHint = false,
  shiftKey,
  altKey = false,
  isComposing,
}: {
  key: string;
  text: string;
  hasSelectedSkill: boolean;
  attachmentCount: number;
  annotationCount: number;
  sessionReferenceCount?: number;
  slashPickerOpen: boolean;
  hasSlashSelection: boolean;
  /** The typed command declares an argument hint that Tab can complete. */
  hasSlashInputHint?: boolean;
  shiftKey: boolean;
  altKey?: boolean;
  isComposing: boolean;
}): ComposerKeyAction | null {
  const backspaceTarget = resolveComposerEmptyBackspace({
    key,
    text,
    hasSelectedSkill,
    attachmentCount,
    annotationCount,
    sessionReferenceCount,
  });
  if (backspaceTarget) return `remove-${backspaceTarget}`;

  if (slashPickerOpen) {
    if (key === "ArrowDown") return "slash-next";
    if (key === "ArrowUp") return "slash-previous";
    if (
      key === "Enter"
      && !shiftKey
      && !isComposing
      && hasSlashSelection
    ) {
      return "slash-pick";
    }
    if (key === "Tab" && hasSlashSelection) return "slash-pick";
    if (key === "Escape") return "slash-dismiss";
    // The picker owns Tab while it is open, even with a stale selection:
    // accepting a command is the picker's job, completing a hint is not.
    if (key === "Tab") return null;
  }

  // The picker is closed and the command declares what it expects next:
  // Tab writes the hint in as real text. Shift+Tab keeps its normal meaning
  // (focus traversal), and an IME composition owns its own keys.
  if (key === "Tab" && !shiftKey && !isComposing && hasSlashInputHint) {
    return "slash-apply-hint";
  }
  // Escape hides the ghost hint. The hint itself stays completable, so Tab
  // can still finish the command the picker dismissed.
  if (key === "Escape" && hasSlashInputHint) return "slash-dismiss-hint";

  // pi's editor: Enter steers, Alt+Enter queues a follow-up that waits for
  // the agent to finish. Every profile maps the `queue` intent to the
  // turn-end queue, so the second gesture means the same thing on any harness.
  if (key === "Enter" && altKey && !shiftKey && !isComposing) return "queue";
  if (key === "Enter" && !shiftKey && !isComposing) return "submit";
  return null;
}

export function canSubmitComposer({
  text,
  attachments,
  annotations,
  sessionReferenceCount = 0,
  disabled,
  actionDisabled,
}: {
  text: string;
  attachments?: PromptAttachment[];
  annotations?: PromptAnnotation[];
  sessionReferenceCount?: number;
  disabled: boolean;
  running?: boolean;
  actionDisabled?: boolean;
}): boolean {
  return (
    !disabled
    && !actionDisabled
    && (
      text.trim().length > 0
      || (attachments?.length ?? 0) > 0
      || (annotations?.length ?? 0) > 0
      || sessionReferenceCount > 0
    )
  );
}

export function derivePromptDisplayText(
  text: string,
  attachments: PromptAttachment[],
  annotationCount = 0,
  sessionReferenceCount = 0,
): string {
  if (text.trim().length > 0) return text;
  if (attachments.length === 0 && annotationCount > 0) {
    return "";
  }
  if (attachments.length === 0) {
    if (sessionReferenceCount > 0) {
      return sessionReferenceCount === 1
        ? "[1 referenced session]"
        : `[${sessionReferenceCount} referenced sessions]`;
    }
    return text;
  }
  if (attachments.length === 1) {
    const attachment = attachments[0]!;
    return `[Attached ${attachment.kind}: ${attachment.name}]`;
  }
  const names = attachments.map((attachment) => attachment.name).join(", ");
  return `[Attached ${attachments.length} files: ${names}]`;
}

export function deriveChatLabel(
  text: string,
  now = new Date(),
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return `Chat · ${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  }
  const firstLine = trimmed.split(/\r?\n/)[0]!;
  if (firstLine.length <= 40) return firstLine;
  return `${firstLine.slice(0, 39).trimEnd()}…`;
}
