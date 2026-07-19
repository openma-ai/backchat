import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  MessageCircleIcon,
  MicIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";

import type { PromptAnnotation } from "@shared/session-events.js";
import { cn } from "@/lib/utils";

export type SelectionRect = Pick<
  DOMRect,
  "top" | "right" | "bottom" | "left" | "width" | "height"
>;

export function AnnotationBadge({ index }: { index: number }) {
  return (
    <span
      className={cn(
        "relative inline-flex size-6 items-center justify-center",
        "text-[10px] font-semibold tabular-nums text-white",
        "drop-shadow-[0_1px_1px_rgb(0_0_0/0.16)]",
      )}
      aria-hidden="true"
    >
      <MessageCircleIcon
        className="absolute inset-0 size-6 fill-info"
        style={{ color: "color-mix(in srgb, var(--info) 84%, white)" }}
        strokeWidth={1.25}
      />
      <span className="relative z-10 -translate-y-px">{index}</span>
    </span>
  );
}

export const AnnotationEditor = function AnnotationEditor({
  ref,
  annotation,
  index,
  rect,
  showBadge = true,
  details,
  dialogLabel = "Response annotation",
  onSave,
  onCancel,
  onRemove,
}: {
  ref: RefObject<HTMLDivElement | null>;
  annotation: PromptAnnotation;
  index: number;
  rect: SelectionRect;
  showBadge?: boolean;
  details?: ReactNode;
  dialogLabel?: string;
  onSave: (comment: string) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const [draftComment, setDraftComment] = useState(annotation.comment ?? "");
  const [isListening, setIsListening] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const hasComment = draftComment.trim().length > 0;
  const expanded = annotationEditorExpanded(draftComment, !!details, detailsOpen);
  const position = annotationEditorPosition(rect, undefined, detailsOpen ? 380 : 320);

  useEffect(() => {
    setDraftComment(annotation.comment ?? "");
    setDetailsOpen(false);
  }, [annotation.comment, annotation.id]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const minHeight = hasComment ? 64 : 28;
    const maxHeight = 220;
    textarea.style.height = "0px";
    const nextHeight = Math.min(
      maxHeight,
      Math.max(minHeight, textarea.scrollHeight),
    );
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draftComment, hasComment]);

  useEffect(() => () => {
    recognitionRef.current?.abort?.();
  }, []);

  const stopVoiceComment = () => {
    recognitionRef.current?.stop();
  };

  const startVoiceComment = () => {
    const SpeechRecognition = speechRecognitionConstructor();
    if (!SpeechRecognition) {
      textareaRef.current?.focus();
      return;
    }
    recognitionRef.current?.abort?.();
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = document.documentElement.lang || navigator.language || "en-US";
    recognition.onresult = (event) => {
      const transcript = speechTranscript(event);
      if (transcript) {
        setDraftComment((current) => current.trim()
          ? `${current.trimEnd()} ${transcript}`
          : transcript);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  return (
    <>
      {showBadge && (
        <span
          data-response-annotation-badge
          className={cn(
            "fixed z-[92] inline-flex size-6 items-center justify-center",
            "animate-in fade-in-0 zoom-in-90 duration-150 motion-reduce:animate-none",
          )}
          style={{ left: position.badgeLeft, top: position.badgeTop }}
          aria-hidden="true"
        >
          <AnnotationBadge index={index} />
        </span>
      )}
      <div
        ref={ref}
        role="dialog"
        aria-label={dialogLabel}
        className={cn(
          "fixed z-[91] max-w-[calc(100vw-24px)] rounded-2xl bg-bg text-sm text-fg",
          "shadow-md ring-1 ring-border/65",
          "animate-in fade-in-0 duration-150 motion-reduce:animate-none",
          expanded
            ? "min-h-[136px] p-3"
            : "flex min-h-16 items-center px-4 py-2",
        )}
        style={{
          left: position.bubbleLeft,
          top: position.bubbleTop,
          width: position.bubbleWidth,
        }}
      >
        <div
          className={cn(
            "flex min-w-0 flex-1",
            expanded ? "items-start px-1" : "items-center",
          )}
        >
          <textarea
            ref={textareaRef}
            autoFocus
            rows={1}
            value={draftComment}
            onChange={(event) => setDraftComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
              if (
                event.key === "Enter"
                && (event.metaKey || event.ctrlKey)
                && !event.nativeEvent.isComposing
                && (hasComment || detailsOpen)
              ) {
                event.preventDefault();
                onSave(draftComment.trim());
              }
            }}
            placeholder="Add an optional comment…"
            className={cn(
              "min-w-0 flex-1 resize-none bg-transparent text-sm leading-6 text-fg outline-none",
              "placeholder:text-fg-muted",
              hasComment ? "w-full py-1" : "py-0.5 pr-3",
            )}
          />
          {!hasComment && (
            <button
              type="button"
              onClick={isListening ? stopVoiceComment : startVoiceComment}
              aria-label={isListening ? "Stop voice comment" : "Record voice comment"}
              title={isListening ? "Stop voice input" : "Voice input"}
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted",
                "hover:bg-bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35",
                isListening && "bg-danger-subtle text-danger",
              )}
            >
              {isListening
                ? <SquareIcon className="size-3.5 fill-current" />
                : <MicIcon className="size-4.5" />}
            </button>
          )}
          {details && (
            <button
              type="button"
              onClick={() => setDetailsOpen((current) => !current)}
              aria-label={detailsOpen ? "Hide style controls" : "Show style controls"}
              title={detailsOpen ? "Hide style controls" : "Style controls"}
              aria-pressed={detailsOpen}
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted",
                "hover:bg-bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35",
                detailsOpen && "bg-bg-surface text-fg",
              )}
            >
              <SlidersHorizontalIcon className="size-4.5" />
            </button>
          )}
        </div>
        {detailsOpen ? details : null}
        {expanded && (
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2.5">
            <button
              type="button"
              onClick={onRemove}
              aria-label="Delete annotation"
              title="Delete annotation"
              className="inline-flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-danger-subtle hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30"
            >
              <Trash2Icon className="size-4" />
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="h-8 rounded-full px-3 text-sm font-medium text-fg-muted ring-1 ring-border hover:bg-bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onSave(draftComment.trim())}
                aria-label="Save annotation comment"
                className="h-8 rounded-full bg-fg px-3.5 text-sm font-medium text-bg hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40 focus-visible:ring-offset-2"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export function annotationEditorExpanded(
  comment: string,
  hasDetails: boolean,
  detailsOpen: boolean,
): boolean {
  return comment.trim().length > 0 || (hasDetails && detailsOpen);
}

type AnnotationViewport = {
  width: number;
  height: number;
};

export function annotationEditorPosition(
  rect: SelectionRect,
  viewport: AnnotationViewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  },
  preferredWidth = 320,
): {
  badgeLeft: number;
  badgeTop: number;
  bubbleLeft: number;
  bubbleTop: number;
  bubbleWidth: number;
} {
  const badgeSize = 24;
  const editorGap = 12;
  const viewportInset = 12;
  const desiredBadgeLeft = rect.right + 4;
  const badgeFitsRight = desiredBadgeLeft + badgeSize <= viewport.width - viewportInset;
  const badgeLeft = badgeFitsRight
    ? desiredBadgeLeft
    : Math.max(viewportInset, rect.left - badgeSize - 4);
  const badgeTop = rect.top >= 36
    ? rect.top - badgeSize
    : Math.min(viewport.height - badgeSize - viewportInset, rect.bottom + 8);
  const bubbleWidth = Math.min(preferredWidth, viewport.width - viewportInset * 2);
  const rightBubbleLeft = badgeLeft + badgeSize + editorGap;
  const rightSideFits = rightBubbleLeft + bubbleWidth <= viewport.width - viewportInset;
  const leftBubbleLeft = badgeLeft - editorGap - bubbleWidth;
  const bubbleLeft = rightSideFits
    ? rightBubbleLeft
    : clamp(
        leftBubbleLeft,
        viewportInset,
        viewport.width - bubbleWidth - viewportInset,
      );
  const bubbleTop = clamp(
    badgeTop - 72,
    viewportInset,
    Math.max(viewportInset, viewport.height - 76),
  );
  return {
    badgeLeft,
    badgeTop,
    bubbleLeft,
    bubbleTop,
    bubbleWidth,
  };
}

type SpeechRecognitionResultLike = ArrayLike<{ transcript: string }>;

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition
    ?? speechWindow.webkitSpeechRecognition
    ?? null;
}

function speechTranscript(event: SpeechRecognitionEventLike): string {
  const transcripts: string[] = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const transcript = event.results[index]?.[0]?.transcript?.trim();
    if (transcript) transcripts.push(transcript);
  }
  return transcripts.join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
