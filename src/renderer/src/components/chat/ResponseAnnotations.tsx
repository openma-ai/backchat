import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import type { PromptAnnotation } from "@shared/session-events.js";
import { cn } from "@/lib/utils";
import {
  numberPromptAnnotations,
  promptAnnotationStore,
  usePromptAnnotations,
} from "@/lib/prompt-annotations";
import { isBrowserPageAnnotation } from "@/lib/browser-element-annotation";
import {
  AnnotationBadge,
  AnnotationEditor,
  annotationEditorPosition,
  type SelectionRect,
} from "./AnnotationEditor";

export {
  ComposerAnnotationStrip,
  annotationAttachment,
  annotationSummary,
} from "./ComposerAnnotations";
export {
  AnnotationBadge,
  AnnotationEditor,
  annotationEditorExpanded,
  annotationEditorPosition,
} from "./AnnotationEditor";

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
