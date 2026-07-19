import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { toast } from "sonner";

import type {
  PromptAnnotation,
  PromptAttachment,
} from "@shared/session-events.js";
import { browserAnnotationScreenshotName } from "./browser-element-annotation";
import { mergeComposerAttachments } from "./composer-attachments";
import {
  composerInsertionStore,
  useComposerInsertions,
} from "./composer-insertions";
import {
  promptAnnotationStore,
  usePromptAnnotations,
} from "./prompt-annotations";

export function composerScreenshotNames(
  annotations: readonly PromptAnnotation[],
): Set<string> {
  return new Set(
    annotations.flatMap((annotation) => {
      const screenshotName = browserAnnotationScreenshotName(annotation);
      return screenshotName ? [screenshotName] : [];
    }),
  );
}

export function removedComposerScreenshotNames(
  previous: ReadonlySet<string>,
  current: ReadonlySet<string>,
): Set<string> {
  return new Set([...previous].filter((name) => !current.has(name)));
}

export function linkedComposerAnnotationIds(
  annotations: readonly PromptAnnotation[],
  attachmentName: string,
): string[] {
  return annotations.flatMap((annotation) =>
    browserAnnotationScreenshotName(annotation) === attachmentName
      ? [annotation.id]
      : [],
  );
}

export function useComposerContextState({
  sessionId,
  disabled,
  attachmentDefaultPath,
  textareaRef,
}: {
  sessionId?: string;
  disabled: boolean;
  attachmentDefaultPath?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const annotations = usePromptAnnotations(sessionId);
  const browserScreenshotNames = useMemo(
    () => composerScreenshotNames(annotations),
    [annotations],
  );
  const previousBrowserScreenshotNamesRef = useRef(browserScreenshotNames);
  const previousBrowserScreenshotSessionRef = useRef(sessionId);
  const composerInsertions = useComposerInsertions(sessionId);

  const focusTextarea = () => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const pickAttachments = async () => {
    if (disabled) return;
    try {
      const files = await window.backchat.uiFsPickFiles({
        defaultPath: attachmentDefaultPath,
      });
      if (files.length === 0) return;
      setAttachments((current) => mergeComposerAttachments(current, files));
      focusTextarea();
    } catch (error) {
      toast.error("Couldn't attach files", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  useEffect(() => {
    if (!sessionId || composerInsertions.length === 0) return;
    const incomingAttachments = composerInsertions.flatMap(
      (insertion) => insertion.attachments,
    );
    if (incomingAttachments.length > 0) {
      setAttachments((current) =>
        mergeComposerAttachments(current, incomingAttachments));
    }
    composerInsertionStore.consume(
      sessionId,
      composerInsertions.map((insertion) => insertion.id),
    );
    focusTextarea();
  }, [composerInsertions, sessionId]);

  useEffect(() => {
    if (previousBrowserScreenshotSessionRef.current !== sessionId) {
      previousBrowserScreenshotSessionRef.current = sessionId;
      previousBrowserScreenshotNamesRef.current = browserScreenshotNames;
      return;
    }
    const removed = removedComposerScreenshotNames(
      previousBrowserScreenshotNamesRef.current,
      browserScreenshotNames,
    );
    previousBrowserScreenshotNamesRef.current = browserScreenshotNames;
    if (removed.size === 0) return;
    setAttachments((current) =>
      current.filter((attachment) => !removed.has(attachment.name)));
  }, [browserScreenshotNames, sessionId]);

  const removeAttachment = (attachmentId: string, focus = true) => {
    const removed = attachments.find(
      (attachment) => attachment.id === attachmentId,
    );
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId));
    if (removed && sessionId) {
      for (const annotationId of linkedComposerAnnotationIds(
        annotations,
        removed.name,
      )) {
        promptAnnotationStore.remove(sessionId, annotationId);
      }
    }
    if (focus) focusTextarea();
  };

  const removeAnnotation = (annotationId: string, focus = true) => {
    const removed = annotations.find(
      (annotation) => annotation.id === annotationId,
    );
    const screenshotName = removed
      ? browserAnnotationScreenshotName(removed)
      : null;
    if (screenshotName) {
      setAttachments((current) =>
        current.filter((attachment) => attachment.name !== screenshotName));
    }
    if (sessionId) promptAnnotationStore.remove(sessionId, annotationId);
    if (focus) focusTextarea();
  };

  const removeLastAttachment = () => {
    const last = attachments[attachments.length - 1];
    if (last) removeAttachment(last.id, false);
  };

  const removeLastAnnotation = () => {
    const last = annotations[annotations.length - 1];
    if (last) removeAnnotation(last.id, false);
  };

  return {
    annotations,
    attachments,
    browserScreenshotNames,
    clearAttachments: () => setAttachments([]),
    pickAttachments,
    removeAnnotation,
    removeAttachment,
    removeLastAnnotation,
    removeLastAttachment,
  };
}
