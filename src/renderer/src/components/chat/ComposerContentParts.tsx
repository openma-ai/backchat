import { useLayoutEffect, type RefObject } from "react";
import { BoxIcon, FileTextIcon, XIcon } from "lucide-react";

import type { PromptAttachment } from "@shared/session-events.js";
import { attachmentExtensionLabel } from "@/lib/composer-attachments";
import { skillCommandLabel } from "@/lib/composer-slash-commands";
import type { HomeSuggestionTemplate } from "@/lib/home-suggestion-flow";
import type { AcpAvailableCommand } from "@/lib/session-store";
import { cn } from "@/lib/utils";

export function SuggestionTemplateEditor({
  inputRef,
  template,
  value,
  disabled,
  onChange,
  onRemove,
  onSubmit,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  template: HomeSuggestionTemplate;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
  onSubmit: () => void;
}) {
  const width = Math.min(
    240,
    Math.max(88, (value || template.slotLabel).length * 14 + 42),
  );
  useLayoutEffect(() => {
    if (disabled) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(value.length, value.length);
  }, [disabled, inputRef, template]);

  return (
    <div className="composer-template-row flex min-h-[60px] w-full flex-wrap items-baseline gap-y-2 text-sm leading-7 text-fg">
      <span className="whitespace-pre-wrap">{template.before}</span>
      <span className="home-suggestion-slot-token">
        <input
          ref={inputRef}
          value={value}
          disabled={disabled}
          aria-label={template.slotLabel}
          placeholder={template.slotLabel}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && value.length === 0) {
              event.preventDefault();
              onRemove();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onRemove();
              return;
            }
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              onSubmit();
            }
          }}
          style={{ width }}
          className="min-w-0 bg-transparent text-sm leading-7 text-fg outline-none placeholder:text-fg-subtle"
        />
        <button
          type="button"
          aria-label="Remove template field"
          title="Remove field"
          disabled={disabled}
          onClick={onRemove}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg hover:text-fg focus:outline-none focus:ring-2 focus:ring-ring/40"
        >
          <XIcon className="size-3" />
        </button>
      </span>
      <span className="whitespace-pre-wrap">{template.after}</span>
    </div>
  );
}

export function AttachmentPreviewStrip({
  attachments,
  browserScreenshotNames,
  onRemove,
}: {
  attachments: PromptAttachment[];
  browserScreenshotNames: ReadonlySet<string>;
  onRemove: (id: string) => void;
}) {
  const visibleAttachments = attachments.filter(
    (attachment) => !browserScreenshotNames.has(attachment.name),
  );
  if (visibleAttachments.length === 0) return null;

  return (
    <div
      className="flex w-full flex-wrap items-center gap-2"
      aria-label="Attachments"
    >
      {visibleAttachments.map((attachment) => {
        const isPreviewableImage =
          attachment.kind === "image" &&
          attachment.data &&
          attachment.mimeType;
        if (isPreviewableImage) {
          return (
            <div
              key={attachment.id}
              className="group/attachment relative size-11 overflow-hidden rounded-md border border-border/50 bg-bg/50"
              title={attachment.name}
            >
              <img
                src={`data:${attachment.mimeType};base64,${attachment.data}`}
                alt={attachment.name}
                className="size-full object-cover"
              />
              <AttachmentRemoveButton
                attachment={attachment}
                onRemove={onRemove}
              />
            </div>
          );
        }
        return (
          <div
            key={attachment.id}
            aria-label={attachment.name}
            title={attachment.path}
            className={cn(
              "group/attachment relative size-11 overflow-hidden rounded-md border border-border/50",
              "bg-bg/45 text-fg-muted",
            )}
          >
            <div className="flex size-full flex-col items-center justify-center gap-0.5">
              <FileTextIcon className="size-4 text-fg-subtle" />
              <span className="max-w-full px-1 text-[9px] font-medium uppercase leading-none text-fg-subtle">
                {attachmentExtensionLabel(attachment.name)}
              </span>
            </div>
            <AttachmentRemoveButton
              attachment={attachment}
              onRemove={onRemove}
            />
          </div>
        );
      })}
    </div>
  );
}

function AttachmentRemoveButton({
  attachment,
  onRemove,
}: {
  attachment: PromptAttachment;
  onRemove: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Remove ${attachment.name}`}
      onClick={() => onRemove(attachment.id)}
      className={cn(
        "absolute right-0.5 top-0.5 inline-flex size-5 items-center justify-center rounded",
        "bg-bg/90 text-fg-muted opacity-0 shadow-sm",
        "group-hover/attachment:opacity-100 focus:opacity-100 hover:text-fg",
        "transition-opacity",
      )}
    >
      <XIcon className="size-3" />
    </button>
  );
}

export function SkillCommandChip({
  command,
  onRemove,
}: {
  command: AcpAvailableCommand;
  onRemove: () => void;
}) {
  const label = skillCommandLabel(command);
  return (
    <button
      type="button"
      aria-label={`Skill ${label}`}
      title="Remove skill"
      onClick={onRemove}
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-md px-0 py-1",
        "bg-transparent text-info",
        "hover:text-info/85 focus:outline-none focus:ring-2 focus:ring-ring/40",
        "transition-colors",
      )}
    >
      <BoxIcon className="size-4 shrink-0" />
      <span className="min-w-0 truncate text-sm font-medium">{label}</span>
    </button>
  );
}
