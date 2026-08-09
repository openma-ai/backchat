import { useLayoutEffect, type RefObject } from "react";
import { AtSignIcon, BoxIcon, FileTextIcon, XIcon } from "lucide-react";

import type {
  PromptAttachment,
  PromptSessionReference,
} from "@shared/session-events.js";
import { attachmentExtensionLabel } from "@/lib/composer-attachments";
import { skillCommandLabel } from "@/lib/composer-slash-commands";
import type { HomeSuggestionTemplate } from "@/lib/home-suggestion-flow";
import type { AcpAvailableCommand } from "@/lib/session-store";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
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
          aria-label={t("composer.removeTemplateField")}
          title={t("composer.removeField")}
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
  hiddenAttachmentIds,
  onRemove,
}: {
  attachments: PromptAttachment[];
  browserScreenshotNames: ReadonlySet<string>;
  hiddenAttachmentIds?: ReadonlySet<string>;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  const visibleAttachments = attachments.filter(
    (attachment) =>
      !browserScreenshotNames.has(attachment.name) &&
      !hiddenAttachmentIds?.has(attachment.id),
  );
  if (visibleAttachments.length === 0) return null;

  return (
    <div
      className="flex w-full flex-wrap items-center gap-2"
      aria-label={t("composer.attachments")}
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

/** File mentions are represented as inline composer blocks, just like
 * session references. The attachment remains in the prompt payload; this
 * strip only changes how it is presented while composing. */
export function MentionedFileStrip({
  attachments,
  onOpen,
  onRemove,
}: {
  attachments: PromptAttachment[];
  onOpen: (attachment: PromptAttachment) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  if (attachments.length === 0) return null;
  return (
    <div
      className="inline-flex max-w-full shrink-0 flex-wrap items-center gap-1.5"
      aria-label={t("composer.mentionedFiles")}
    >
      {attachments.map((attachment) => (
        <span
          key={attachment.id}
          className={cn(
            "inline-flex h-7 max-w-full items-center rounded-lg",
            "bg-info/10 text-xs font-medium text-info ring-1 ring-info/25",
          )}
        >
          <button
            type="button"
            aria-label={`Open ${attachment.name}`}
            title={attachment.path}
            onClick={() => onOpen(attachment)}
            className="inline-flex h-full min-w-0 items-center gap-1.5 rounded-l-lg pl-2 pr-1 hover:bg-info/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/45"
          >
            <FileTextIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{attachment.name}</span>
          </button>
          <button
            type="button"
            aria-label={`Remove ${attachment.name}`}
            title={`Remove ${attachment.name}`}
            onClick={() => onRemove(attachment.id)}
            className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-info/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/45"
          >
            <XIcon className="size-3 opacity-70" aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );
}

export function SessionReferenceStrip({
  references,
  onOpen,
  onRemove,
}: {
  references: PromptSessionReference[];
  onOpen: (sessionId: string) => void;
  onRemove: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  if (references.length === 0) return null;
  return (
    <div
      className="inline-flex max-w-full shrink-0 flex-wrap items-center gap-1.5"
      aria-label={t("chat.referencedSessions")}
    >
      {references.map((reference) => (
        <span
          key={reference.session_id}
          className={cn(
            "inline-flex h-7 max-w-full items-center rounded-lg",
            "bg-info/10 text-xs font-medium text-info ring-1 ring-info/25",
          )}
        >
          <button
            type="button"
            aria-label={`${t("chat.openSessionReference")}: ${reference.title}`}
            title={`${t("chat.openSessionReference")}: ${reference.title}`}
            onClick={() => onOpen(reference.session_id)}
            className="inline-flex h-full min-w-0 items-center gap-1.5 rounded-l-lg pl-2 pr-1 hover:bg-info/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/45"
          >
            <AtSignIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{reference.title}</span>
          </button>
          <button
            type="button"
            aria-label={`${t("chat.removeSessionReference")}: ${reference.title}`}
            title={`${t("chat.removeSessionReference")}: ${reference.title}`}
            onClick={() => onRemove(reference.session_id)}
            className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-info/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/45"
          >
            <XIcon className="size-3 opacity-70" aria-hidden="true" />
          </button>
        </span>
      ))}
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
  const { t } = useI18n();
  const label = skillCommandLabel(command);
  return (
    <button
      type="button"
      aria-label={`Skill ${label}`}
      title={t("composer.removeSkill")}
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
