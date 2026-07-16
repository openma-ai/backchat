import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  MessageCircleIcon,
  MessageSquareTextIcon,
  MicIcon,
  ScanSearchIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import type { PromptAnnotation, PromptAttachment } from "@shared/session-events.js";
import { browserAnnotationScreenshotName } from "@/lib/browser-element-annotation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  numberPromptAnnotations,
  promptAnnotationStore,
  usePromptAnnotations,
} from "@/lib/prompt-annotations";
import { isBrowserPageAnnotation } from "@/lib/browser-element-annotation";

type SelectionRect = Pick<
  DOMRect,
  "top" | "right" | "bottom" | "left" | "width" | "height"
>;

type ResponseSelection = {
  range: Range;
  rect: SelectionRect;
  text: string;
  sourceSessionId: string;
  sourceTurnId: string;
};

type AnnotationEditorState = {
  annotationId: string;
  range: Range;
  rect: SelectionRect;
};

export interface ResponseAnnotationMarker {
  annotation: PromptAnnotation;
  index: number;
  range: Range;
  rect: SelectionRect;
}

export function responseAnnotationMarkers(
  annotations: PromptAnnotation[],
  rangesByAnnotationId: Map<string, Range>,
  rectForRange: (range: Range) => SelectionRect | null = visibleRangeRect,
): ResponseAnnotationMarker[] {
  return numberPromptAnnotations(annotations).flatMap(({ annotation, index }) => {
    if (isBrowserPageAnnotation(annotation)) return [];
    const range = rangesByAnnotationId.get(annotation.id);
    if (!range) return [];
    const rect = rectForRange(range);
    return rect ? [{ annotation, index, range, rect }] : [];
  });
}

export function ResponseAnnotationController({
  scopeRef,
  destinationSessionId,
  onAskInSideChat,
}: {
  scopeRef: RefObject<HTMLElement | null>;
  destinationSessionId: string;
  onAskInSideChat?: (annotation: PromptAnnotation) => void | Promise<void>;
}) {
  const annotations = usePromptAnnotations(destinationSessionId);
  const [selection, setSelection] = useState<ResponseSelection | null>(null);
  const [editor, setEditor] = useState<AnnotationEditorState | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const rangesByAnnotationId = useRef(new Map<string, Range>());
  const [, setMarkerLayoutVersion] = useState(0);

  useEffect(() => ensureAnnotationHighlightStyles(), []);

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;

    const readSelection = () => {
      const browserSelection = window.getSelection();
      if (!browserSelection || browserSelection.isCollapsed || browserSelection.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const range = browserSelection.getRangeAt(0);
      const source = annotationSourceForRange(range, scope);
      const text = range.toString().trim();
      if (!source || source.dataset.annotationReady !== "true" || text.length === 0) {
        setSelection(null);
        return;
      }
      const rect = visibleRangeRect(range);
      if (!rect) {
        setSelection(null);
        return;
      }
      setSelection({
        range: range.cloneRange(),
        rect,
        text,
        sourceSessionId: source.dataset.sourceSessionId ?? destinationSessionId,
        sourceTurnId: source.dataset.sourceTurnId ?? "",
      });
    };

    scope.addEventListener("mouseup", readSelection);
    scope.addEventListener("keyup", readSelection);
    return () => {
      scope.removeEventListener("mouseup", readSelection);
      scope.removeEventListener("keyup", readSelection);
    };
  }, [destinationSessionId, scopeRef]);

  useEffect(() => {
    let animationFrame = 0;
    const syncPosition = () => {
      if (animationFrame) return;
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        setSelection((current) => {
          if (!current) return current;
          const rect = visibleRangeRect(current.range);
          return rect ? { ...current, rect } : null;
        });
        setEditor((current) => {
          if (!current) return current;
          const rect = visibleRangeRect(current.range);
          return rect ? { ...current, rect } : null;
        });
        setMarkerLayoutVersion((current) => current + 1);
      });
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelection(null);
      setEditor(null);
    };
    window.addEventListener("resize", syncPosition);
    document.addEventListener("scroll", syncPosition, true);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", syncPosition);
      document.removeEventListener("scroll", syncPosition, true);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, []);

  useEffect(() => {
    const activeIds = new Set(annotations.map((annotation) => annotation.id));
    for (const id of rangesByAnnotationId.current.keys()) {
      if (!activeIds.has(id)) rangesByAnnotationId.current.delete(id);
    }
    installAnnotationHighlight([...rangesByAnnotationId.current.values()]);
    return () => clearAnnotationHighlight();
  }, [annotations]);

  useEffect(() => {
    if (!editor) return;
    if (!annotations.some((annotation) => annotation.id === editor.annotationId)) {
      setEditor(null);
    }
  }, [annotations, editor]);

  useEffect(() => {
    if (!editor) return;
    const closeOutside = (event: PointerEvent) => {
      if (editorRef.current?.contains(event.target as Node)) return;
      setEditor(null);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [editor?.annotationId]);

  const addSelection = (
    selected: ResponseSelection,
    comment?: string,
  ): PromptAnnotation => {
    const annotation: PromptAnnotation = {
      id: createAnnotationId(),
      source_session_id: selected.sourceSessionId,
      source_turn_id: selected.sourceTurnId,
      text: selected.text,
      ...(comment ? { comment } : {}),
    };
    rangesByAnnotationId.current.set(annotation.id, selected.range);
    promptAnnotationStore.add(destinationSessionId, annotation);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    return annotation;
  };

  const addToPrompt = (comment?: string) => {
    if (!selection) return;
    const annotation = addSelection(selection, comment);
    setEditor({
      annotationId: annotation.id,
      range: selection.range,
      rect: selection.rect,
    });
  };

  const askInSideChat = async () => {
    if (!selection || !onAskInSideChat) return;
    const annotation: PromptAnnotation = {
      id: createAnnotationId(),
      source_session_id: selection.sourceSessionId,
      source_turn_id: selection.sourceTurnId,
      text: selection.text,
    };
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    await onAskInSideChat(annotation);
  };

  const numberedAnnotations = numberPromptAnnotations(annotations);
  const focusedNumberedAnnotation = editor
    ? numberedAnnotations.find(({ annotation }) => annotation.id === editor.annotationId)
    : undefined;
  const focusedAnnotation = focusedNumberedAnnotation?.annotation;
  const focusedAnnotationIndex = focusedNumberedAnnotation?.index ?? 0;
  const responseMarkers = responseAnnotationMarkers(
    annotations,
    rangesByAnnotationId.current,
  );
  return (
    <>
      {selection && createPortal(
        <SelectionToolbar
          ref={toolbarRef}
          rect={selection.rect}
          showSideChatAction={!!onAskInSideChat}
          onAdd={() => addToPrompt()}
          onAskInSideChat={() => void askInSideChat()}
        />,
        document.body,
      )}

      {responseMarkers.length > 0 && createPortal(
        <div data-response-annotation-markers>
          {responseMarkers.map((marker) => {
            const position = annotationEditorPosition(marker.rect);
            return (
              <button
                key={marker.annotation.id}
                type="button"
                data-response-annotation-marker={marker.annotation.id}
                aria-label={`Edit response annotation ${marker.index}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={() => {
                  setSelection(null);
                  setEditor({
                    annotationId: marker.annotation.id,
                    range: marker.range,
                    rect: marker.rect,
                  });
                }}
                className={cn(
                  "fixed z-[92] size-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40",
                  editor?.annotationId === marker.annotation.id && "scale-105",
                )}
                style={{ left: position.badgeLeft, top: position.badgeTop }}
              >
                <AnnotationBadge index={marker.index} />
              </button>
            );
          })}
        </div>,
        document.body,
      )}

      {editor && focusedAnnotation && createPortal(
        <AnnotationEditor
          ref={editorRef}
          annotation={focusedAnnotation}
          index={focusedAnnotationIndex}
          rect={editor.rect}
          showBadge={false}
          onSave={(comment) => {
            promptAnnotationStore.update(
              destinationSessionId,
              focusedAnnotation.id,
              { comment },
            );
            setEditor(null);
            focusSurfaceComposer(scopeRef.current);
          }}
          onCancel={() => {
            setEditor(null);
            focusSurfaceComposer(scopeRef.current);
          }}
          onRemove={() => {
            rangesByAnnotationId.current.delete(focusedAnnotation.id);
            promptAnnotationStore.remove(
              destinationSessionId,
              focusedAnnotation.id,
            );
            setEditor(null);
            focusSurfaceComposer(scopeRef.current);
          }}
        />,
        document.body,
      )}
    </>
  );
}

const SelectionToolbar = function SelectionToolbar({
  ref,
  rect,
  showSideChatAction,
  onAdd,
  onAskInSideChat,
}: {
  ref: RefObject<HTMLDivElement | null>;
  rect: SelectionRect;
  showSideChatAction: boolean;
  onAdd: () => void;
  onAskInSideChat: () => void;
}) {
  const position = selectionToolbarPosition(rect);
  const preserveSelection = (event: React.PointerEvent) => event.preventDefault();
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selected response actions"
      data-response-selection-toolbar
      className={cn(
        "fixed z-[90] flex max-w-[calc(100vw-24px)] items-center overflow-hidden rounded-md",
        "bg-bg-surface text-xs text-fg shadow-md ring-1 ring-border/60",
        "animate-in fade-in-0 zoom-in-95 duration-150",
      )}
      style={{ left: position.left, top: position.top, transform: "translateX(-50%)" }}
      onPointerDown={preserveSelection}
    >
      <SelectionAction onClick={onAdd}>Add to prompt</SelectionAction>
      {showSideChatAction && (
        <SelectionAction onClick={onAskInSideChat}>Ask in side chat</SelectionAction>
      )}
    </div>
  );
};

function SelectionAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 whitespace-nowrap border-r border-border/60 px-2.5 font-medium last:border-r-0",
        "hover:bg-bg-subtle focus-visible:bg-bg-subtle focus-visible:outline-none",
        "transition-colors",
      )}
    >
      {children}
    </button>
  );
}

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
        <div className={cn("flex min-w-0 flex-1 items-start", expanded && "px-1")}>
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
              hasComment ? "w-full py-1" : "pr-3",
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

export function ComposerAnnotationStrip({
  annotations,
  attachments,
  onRemove,
}: {
  annotations: PromptAnnotation[];
  attachments: PromptAttachment[];
  onRemove: (annotationId: string) => void;
}) {
  const browserOnly = annotations.every(isBrowserPageAnnotation);
  const label = annotationCountLabel(annotations.length, browserOnly);
  const TriggerIcon = browserOnly ? ScanSearchIcon : MessageSquareTextIcon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-lg bg-bg/55 px-2.5 ring-1 ring-border/60",
            "text-xs font-medium text-fg-muted hover:bg-bg-subtle hover:text-fg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35",
          )}
        >
          <TriggerIcon className="size-3.5" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        aria-label="Response annotations"
        className="w-[min(420px,calc(100vw-24px))] gap-0 p-3"
      >
        <div className="max-h-72 overflow-y-auto">
          {numberPromptAnnotations(annotations).map(({ annotation, index }) => {
            const summary = annotationSummary(annotation);
            const screenshot = annotationAttachment(annotation, attachments);
            return (
              <div
                key={annotation.id}
                className="flex items-start gap-2 border-b border-border/50 py-2 first:pt-0 last:border-b-0 last:pb-0"
              >
                <span className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-fg-subtle">
                  {index}.
                </span>
                <div className="min-w-0 flex-1">
                  {screenshot?.data && screenshot.mimeType && (
                    <img
                      src={`data:${screenshot.mimeType};base64,${screenshot.data}`}
                      alt={`Screenshot for annotation ${index}`}
                      className="mb-2 h-16 w-24 rounded-md border border-border/60 object-cover object-top"
                    />
                  )}
                  <div className="text-[11px] text-fg-subtle">
                    {summary.sourceLabel}
                  </div>
                  <p className="mt-0.5 line-clamp-5 whitespace-pre-wrap text-sm leading-5 text-fg">
                    {summary.primaryText}
                  </p>
                  {summary.sourceUrl && (
                    <p className="mt-1 truncate text-[11px] text-fg-subtle" title={summary.sourceUrl}>
                      {summary.sourceText}
                    </p>
                  )}
                  {annotation.comment?.trim() && (
                    <div className="mt-2">
                      <div className="text-[11px] text-fg-subtle">Comment</div>
                      <p className="mt-0.5 line-clamp-3 text-xs leading-5 text-fg-muted">
                        {annotation.comment.trim()}
                      </p>
                    </div>
                  )}
                  {annotation.browser?.style_changes?.length ? (
                    <div className="mt-2 space-y-1">
                      {annotation.browser.style_changes.map((change) => (
                        <div
                          key={change.property}
                          className="truncate font-mono text-[11px] text-fg-muted"
                          title={`${change.property}: ${change.from} -> ${change.to}`}
                        >
                          {change.property}: {change.from} → {change.to}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(annotation.id)}
                  aria-label={`Remove annotation ${index}`}
                  title="Remove annotation"
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-subtle hover:text-danger"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function annotationSummary(annotation: PromptAnnotation): {
  sourceLabel: string;
  primaryText: string;
  sourceText?: string;
  sourceUrl?: string;
} {
  if (annotation.kind === "browser_element" && annotation.browser) {
    return {
      sourceLabel: "Page element",
      primaryText: browserElementIdentity(annotation.browser),
      sourceText: annotation.browser.title || annotation.browser.url,
      sourceUrl: annotation.browser.url,
    };
  }
  if (annotation.kind === "browser_region" && annotation.browser_region) {
    const { browser_region: region } = annotation;
    return {
      sourceLabel: "Page region",
      primaryText: annotation.text || `Region ${Math.round(region.rect.width)}x${Math.round(region.rect.height)}`,
      sourceText: region.title || region.url,
      sourceUrl: region.url,
    };
  }
  return {
    sourceLabel: "Selected text",
    primaryText: annotation.text,
  };
}

export function annotationAttachment(
  annotation: PromptAnnotation,
  attachments: PromptAttachment[],
): PromptAttachment | null {
  const screenshotName = browserAnnotationScreenshotName(annotation);
  if (!screenshotName) return null;
  return attachments.find((attachment) => attachment.name === screenshotName) ?? null;
}

function browserElementIdentity(
  browser: NonNullable<PromptAnnotation["browser"]>,
): string {
  if (browser.id) return `${browser.tag_name}#${browser.id}`;
  const ariaLabel = browser.aria_label?.trim();
  if (ariaLabel) return `${browser.tag_name}[aria-label=${JSON.stringify(ariaLabel)}]`;
  const stableClass = browser.class_names.find((name) => (
    name.length <= 32 && !/^[a-zA-Z0-9_-]{10,}$/.test(name)
  ));
  return stableClass ? `${browser.tag_name}.${stableClass}` : browser.tag_name;
}

function annotationSourceForRange(range: Range, scope: HTMLElement): HTMLElement | null {
  const startElement = nodeElement(range.startContainer);
  const endElement = nodeElement(range.endContainer);
  const source = startElement?.closest<HTMLElement>("[data-annotatable-response]") ?? null;
  if (!source || !scope.contains(source) || !endElement || !source.contains(endElement)) return null;
  return source;
}

function nodeElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
}

function visibleRangeRect(range: Range): SelectionRect | null {
  const rect = range.getBoundingClientRect();
  const visible = rect.width > 0 || rect.height > 0
    ? rect
    : range.getClientRects().item(0);
  if (!visible) return null;
  return {
    top: visible.top,
    right: visible.right,
    bottom: visible.bottom,
    left: visible.left,
    width: visible.width,
    height: visible.height,
  };
}

function selectionToolbarPosition(rect: SelectionRect): { left: number; top: number } {
  const estimatedHalfWidth = 180;
  const left = clamp(
    rect.left + rect.width / 2,
    estimatedHalfWidth + 12,
    window.innerWidth - estimatedHalfWidth - 12,
  );
  const top = rect.top >= 50 ? rect.top - 44 : rect.bottom + 8;
  return { left, top: clamp(top, 8, window.innerHeight - 48) };
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

function annotationCountLabel(count: number, browserOnly = false): string {
  if (browserOnly) {
    return `${count} ${count === 1 ? "page annotation" : "page annotations"}`;
  }
  return `${count} ${count === 1 ? "annotation" : "annotations"}`;
}

function createAnnotationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function focusSurfaceComposer(scope: HTMLElement | null): void {
  const surface = scope?.closest<HTMLElement>("[data-chat-surface]");
  requestAnimationFrame(() => surface?.querySelector<HTMLTextAreaElement>("textarea")?.focus());
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

type HighlightConstructor = new (...ranges: Range[]) => unknown;
type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

const HIGHLIGHT_NAME = "backchat-response-annotation";
const HIGHLIGHT_STYLE_ID = "backchat-response-annotation-style";

function ensureAnnotationHighlightStyles(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) {
    background-color: color-mix(in srgb, var(--info) 22%, transparent);
    color: inherit;
  }`;
  document.head.append(style);
}

function installAnnotationHighlight(ranges: Range[]): void {
  const globalWithHighlight = globalThis as typeof globalThis & {
    Highlight?: HighlightConstructor;
    CSS?: typeof CSS & { highlights?: HighlightRegistry };
  };
  if (!globalWithHighlight.Highlight || !globalWithHighlight.CSS?.highlights) return;
  if (ranges.length === 0) {
    globalWithHighlight.CSS.highlights.delete(HIGHLIGHT_NAME);
    return;
  }
  globalWithHighlight.CSS.highlights.set(
    HIGHLIGHT_NAME,
    new globalWithHighlight.Highlight(...ranges),
  );
}

function clearAnnotationHighlight(): void {
  const css = (globalThis as typeof globalThis & {
    CSS?: typeof CSS & { highlights?: HighlightRegistry };
  }).CSS;
  css?.highlights?.delete(HIGHLIGHT_NAME);
}
