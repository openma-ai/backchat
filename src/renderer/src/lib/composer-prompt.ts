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
  | "attachment"
  | "annotation";

export function resolveComposerEmptyBackspace({
  key,
  text,
  hasSelectedSkill,
  attachmentCount,
  annotationCount,
}: {
  key: string;
  text: string;
  hasSelectedSkill: boolean;
  attachmentCount: number;
  annotationCount: number;
}): ComposerEmptyBackspaceTarget | null {
  if (key !== "Backspace" || text.length > 0) return null;
  if (hasSelectedSkill) return "skill";
  if (attachmentCount > 0) return "attachment";
  if (annotationCount > 0) return "annotation";
  return null;
}

export type ComposerKeyAction =
  | "remove-skill"
  | "remove-attachment"
  | "remove-annotation"
  | "slash-next"
  | "slash-previous"
  | "slash-pick"
  | "slash-dismiss"
  | "submit";

export function resolveComposerKeyAction({
  key,
  text,
  hasSelectedSkill,
  attachmentCount,
  annotationCount,
  slashPickerOpen,
  hasSlashSelection,
  shiftKey,
  isComposing,
}: {
  key: string;
  text: string;
  hasSelectedSkill: boolean;
  attachmentCount: number;
  annotationCount: number;
  slashPickerOpen: boolean;
  hasSlashSelection: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}): ComposerKeyAction | null {
  const backspaceTarget = resolveComposerEmptyBackspace({
    key,
    text,
    hasSelectedSkill,
    attachmentCount,
    annotationCount,
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
  }

  if (key === "Enter" && !shiftKey && !isComposing) return "submit";
  return null;
}

export function canSubmitComposer({
  text,
  attachments,
  annotations,
  disabled,
  actionDisabled,
}: {
  text: string;
  attachments?: PromptAttachment[];
  annotations?: PromptAnnotation[];
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
    )
  );
}

export function derivePromptDisplayText(
  text: string,
  attachments: PromptAttachment[],
  annotationCount = 0,
): string {
  if (text.trim().length > 0) return text;
  if (attachments.length === 0 && annotationCount > 0) {
    return annotationCount === 1
      ? "[1 annotation]"
      : `[${annotationCount} annotations]`;
  }
  if (attachments.length === 0) return text;
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
