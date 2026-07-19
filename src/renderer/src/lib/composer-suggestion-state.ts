import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import type {
  ComposerSuggestionDraft,
  HomeSuggestionTemplate,
} from "./home-suggestion-flow";

export function composerSuggestionFillDuration(textLength: number): number {
  return Math.min(680, Math.max(320, textLength * 12));
}

export function composerSuggestionFillLength(
  textLength: number,
  elapsed: number,
  duration: number,
): number {
  const progress = Math.min(1, Math.max(0, elapsed / duration));
  const eased = 1 - Math.pow(1 - progress, 3);
  return Math.min(
    textLength,
    Math.max(1, Math.round(textLength * eased)),
  );
}

export function useComposerSuggestionState({
  suggestionDraft,
  textareaRef,
  setText,
  setDismissedSlashText,
}: {
  suggestionDraft?: ComposerSuggestionDraft | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setText: Dispatch<SetStateAction<string>>;
  setDismissedSlashText: Dispatch<SetStateAction<string | null>>;
}) {
  const [suggestionFillActive, setSuggestionFillActive] = useState(false);
  const [suggestionTemplate, setSuggestionTemplate] =
    useState<HomeSuggestionTemplate | null>(null);
  const [suggestionSlotValue, setSuggestionSlotValue] = useState("");
  const suggestionSlotInputRef = useRef<HTMLInputElement>(null);
  const suggestionAnimationRef = useRef<number | null>(null);
  const cancelSuggestionFill = () => {
    if (suggestionAnimationRef.current != null) {
      cancelAnimationFrame(suggestionAnimationRef.current);
      suggestionAnimationRef.current = null;
    }
    setSuggestionFillActive(false);
  };

  useEffect(() => {
    if (!suggestionDraft) return;

    if (suggestionAnimationRef.current != null) {
      cancelAnimationFrame(suggestionAnimationRef.current);
      suggestionAnimationRef.current = null;
    }

    if (suggestionDraft.template) {
      setText("");
      setSuggestionTemplate(suggestionDraft.template);
      setSuggestionSlotValue("");
      setDismissedSlashText(null);
      setSuggestionFillActive(false);
      suggestionAnimationRef.current = requestAnimationFrame(() => {
        suggestionAnimationRef.current = null;
        suggestionSlotInputRef.current?.focus();
      });
      return () => {
        if (suggestionAnimationRef.current != null) {
          cancelAnimationFrame(suggestionAnimationRef.current);
          suggestionAnimationRef.current = null;
        }
      };
    }

    setSuggestionTemplate(null);
    setSuggestionSlotValue("");
    const focusAtSelection = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(
        suggestionDraft.text.length,
        suggestionDraft.text.length,
      );
    };
    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduceMotion) {
      setText(suggestionDraft.text);
      setSuggestionFillActive(false);
      suggestionAnimationRef.current =
        requestAnimationFrame(focusAtSelection);
      return () => {
        if (suggestionAnimationRef.current != null) {
          cancelAnimationFrame(suggestionAnimationRef.current);
          suggestionAnimationRef.current = null;
        }
      };
    }

    setText("");
    setDismissedSlashText(null);
    setSuggestionFillActive(true);
    const duration = composerSuggestionFillDuration(
      suggestionDraft.text.length,
    );
    let startedAt: number | null = null;
    const fillNextChunk = (timestamp: number) => {
      startedAt ??= timestamp;
      const elapsed = timestamp - startedAt;
      const length = composerSuggestionFillLength(
        suggestionDraft.text.length,
        elapsed,
        duration,
      );
      setText(suggestionDraft.text.slice(0, length));
      if (elapsed < duration) {
        suggestionAnimationRef.current =
          requestAnimationFrame(fillNextChunk);
        return;
      }
      setText(suggestionDraft.text);
      setSuggestionFillActive(false);
      suggestionAnimationRef.current = null;
      focusAtSelection();
    };
    suggestionAnimationRef.current = requestAnimationFrame(fillNextChunk);

    return () => {
      if (suggestionAnimationRef.current != null) {
        cancelAnimationFrame(suggestionAnimationRef.current);
        suggestionAnimationRef.current = null;
      }
      setSuggestionFillActive(false);
    };
  }, [suggestionDraft?.id]);

  return {
    suggestionFillActive,
    suggestionTemplate,
    setSuggestionTemplate,
    suggestionSlotValue,
    setSuggestionSlotValue,
    suggestionSlotInputRef,
    cancelSuggestionFill,
  };
}
