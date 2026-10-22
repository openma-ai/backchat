import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AtSignIcon,
  CalendarClockIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  PencilIcon,
} from "@/components/Icons";
import { useI18n } from "@/lib/i18n";
import type { ScheduledTaskPromptSurface } from "@/lib/scheduled-task-presentation";
import type { Turn } from "@/lib/session-store";
import { cn } from "@/lib/utils";

const LONG_PROMPT_CHAR_LIMIT = 480;
const LONG_PROMPT_LINE_LIMIT = 10;

export function isLongUserPrompt(text: string | undefined): boolean {
  if (!text) return false;
  if (text.length > LONG_PROMPT_CHAR_LIMIT) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      lines += 1;
      if (lines > LONG_PROMPT_LINE_LIMIT) return true;
    }
  }
  return false;
}

/** One look for every per-message action (copy, edit, regenerate, fork), on
 *  both the prompt's and the answer's side. */
export const TURN_ACTION_BUTTON =
  "inline-flex size-7 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const TURN_ACTION_ICON = "size-4";

/** The time a message landed plus the actions that belong to it. One row, so
 *  the prompt and the answer read as the same kind of thing on either side. */
export function TurnMetaActions({
  timestamp,
  copyText,
  align,
  children,
}: {
  timestamp?: number;
  copyText: string;
  align: "start" | "end";
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!copyText) return;
    void navigator.clipboard?.writeText(copyText).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <>
      {timestamp !== undefined && (
        <time
          data-turn-timestamp={String(timestamp)}
          className={cn(
            // Quaternary tier: the time is metadata the turn reads fine without.
            "text-xs leading-5 text-fg-faint",
            align === "start" ? "mr-1" : "ml-1",
          )}
        >
          {new Date(timestamp).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      )}
      {copyText.length > 0 && (
        <button
          type="button"
          data-turn-copy-action="true"
          aria-label={copied ? t("chat.answerCopied") : t("chat.copyAnswer")}
          title={copied ? t("chat.answerCopied") : t("chat.copyAnswer")}
          onClick={copy}
          className={TURN_ACTION_BUTTON}
        >
          {copied ? (
            <CheckIcon className={TURN_ACTION_ICON} aria-hidden="true" />
          ) : (
            <CopyIcon className={TURN_ACTION_ICON} aria-hidden="true" />
          )}
        </button>
      )}
      {children}
    </>
  );
}

export function UserPromptBubble({
  turn,
  text,
  onEditPrompt,
}: {
  turn: Turn;
  text: string;
  onEditPrompt?: (turn: Turn, nextPromptText: string) => void;
}) {
  const { t } = useI18n();
  const isCollapsible = isLongUserPrompt(text);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(text);
  const handleSubmitEdit = () => {
    const trimmed = draftText.trim();
    if (!trimmed || !onEditPrompt) return;
    setEditing(false);
    onEditPrompt(turn, trimmed);
  };

  return (
    <div
      className="group is-user relative ml-auto flex w-full max-w-[95%] flex-col items-end gap-3"
      data-session-turn-prompt="true"
    >
      <div className="is-user:dark ml-auto flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden rounded-lg bg-secondary px-4 py-3 text-sm text-foreground">
        {editing ? (
          <div
            className="flex min-w-[260px] max-w-full flex-col gap-2 sm:min-w-[360px]"
            data-user-prompt-editor="true"
          >
            <textarea
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                  setDraftText(text);
                } else if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey)
                ) {
                  event.preventDefault();
                  handleSubmitEdit();
                }
              }}
              rows={Math.min(8, Math.max(2, draftText.split("\n").length))}
              className="w-full resize-y rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraftText(text);
                }}
                className="rounded-md border border-border-strong bg-bg px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-surface hover:text-fg"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-user-prompt-resend="true"
                aria-disabled={!draftText.trim()}
                onClick={handleSubmitEdit}
                className={cn(
                  "rounded-md bg-fg px-2.5 py-1 text-xs font-medium text-bg shadow-2xs transition-opacity hover:opacity-90",
                  !draftText.trim() && "pointer-events-none opacity-40",
                )}
              >
                {t("chat.resend")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p
              className={cn(
                "whitespace-pre-wrap",
                isCollapsible && !expanded && "max-h-48 overflow-hidden",
              )}
            >
              {text}
            </p>
            {isCollapsible && (
              <button
                type="button"
                data-prompt-collapse-toggle="true"
                onClick={() => setExpanded((value) => !value)}
                className="inline-flex w-fit items-center gap-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
              >
                {expanded ? (
                  <>
                    <ChevronUpIcon className="size-3.5" aria-hidden="true" />
                    <span>{t("chat.showLess")}</span>
                  </>
                ) : (
                  <>
                    <ChevronDownIcon className="size-3.5" aria-hidden="true" />
                    <span>{t("chat.showMore")}</span>
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
      {!editing && (
        // Same row as the answer's footer (time · copy · …), mirrored to the
        // prompt's side. It always holds its 28px, visible or not, so the
        // gaps around it are component gaps — hover never moves anything.
        <div
          data-user-prompt-actions="true"
          data-session-turn-prompt-meta="true"
          className="pointer-events-none flex h-7 items-center justify-end gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
        >
          <TurnMetaActions timestamp={turn.startedAt} copyText={text} align="end">
            {onEditPrompt && (
              <button
                type="button"
                data-prompt-edit-action="true"
                aria-label={t("chat.editPrompt")}
                title={t("chat.editPrompt")}
                onClick={() => {
                  setDraftText(text);
                  setEditing(true);
                }}
                className={TURN_ACTION_BUTTON}
              >
                <PencilIcon className={TURN_ACTION_ICON} aria-hidden="true" />
              </button>
            )}
          </TurnMetaActions>
        </div>
      )}
    </div>
  );
}

export function ScheduledTaskUserPrompt({
  turn,
  surface,
}: {
  turn: Turn;
  surface: ScheduledTaskPromptSurface;
}) {
  return (
    <div
      className="group is-user mb-2 ml-auto flex w-full max-w-[95%] flex-col items-end gap-2"
      data-session-turn-prompt="true"
      data-scheduled-task-prompt="true"
    >
      <div className="is-user:dark ml-auto flex w-fit min-w-0 max-w-full flex-col gap-1.5 overflow-hidden rounded-lg bg-secondary px-3 py-2 text-sm text-foreground">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
          <CalendarClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{surface.name}</span>
        </p>
        {surface.prompt.length > 0 && (
          <p className="whitespace-pre-wrap">{surface.prompt}</p>
        )}
      </div>
      <div
        data-session-turn-prompt-meta="true"
        className="flex min-h-6 items-center justify-end gap-1"
      >
        <TurnMetaActions
          timestamp={turn.startedAt}
          copyText={surface.prompt}
          align="end"
        />
      </div>
    </div>
  );
}

export function ReferencedSessionPrompt({ turn }: { turn: Turn }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const references = turn.sessionReferences ?? [];

  return (
    <div
      className="group is-user mb-2 ml-auto flex w-full max-w-[95%] flex-col items-end gap-2"
      data-session-turn-prompt="true"
    >
      <div className="ml-auto flex w-fit min-w-0 max-w-full flex-wrap items-center gap-1.5 overflow-hidden rounded-lg bg-secondary px-4 py-3 text-sm text-foreground">
        {references.map((reference) => (
          <button
            key={reference.session_id}
            type="button"
            data-session-reference={reference.session_id}
            aria-label={`${t("chat.openSessionReference")}: ${reference.title}`}
            title={`${t("chat.openSessionReference")}: ${reference.title}`}
            onClick={() => {
              void navigate({
                to: "/chat/$sessionId",
                params: { sessionId: reference.session_id },
              });
            }}
            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg bg-info/10 px-2 text-xs font-medium text-info ring-1 ring-info/25 hover:bg-info/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/45"
          >
            <AtSignIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{reference.title}</span>
          </button>
        ))}
        {turn.promptText && (
          <p className="whitespace-pre-wrap">{turn.promptText}</p>
        )}
      </div>
      {/* The prompt's own time and copy, mirrored to its side of the column. */}
      <div
        data-session-turn-prompt-meta="true"
        className="flex min-h-6 items-center justify-end gap-1"
      >
        <TurnMetaActions
          timestamp={turn.startedAt}
          copyText={turn.promptText ?? ""}
          align="end"
        />
      </div>
    </div>
  );
}
