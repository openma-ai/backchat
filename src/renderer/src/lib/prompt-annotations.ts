import { useSyncExternalStore } from "react";

import type { PromptAnnotation } from "@shared/session-events.js";

const EMPTY_ANNOTATIONS: PromptAnnotation[] = [];

export interface NumberedPromptAnnotation {
  annotation: PromptAnnotation;
  index: number;
}

export function numberPromptAnnotations(
  annotations: PromptAnnotation[],
): NumberedPromptAnnotation[] {
  return annotations.map((annotation, index) => ({
    annotation,
    index: index + 1,
  }));
}

class PromptAnnotationStore {
  readonly #bySession = new Map<string, PromptAnnotation[]>();
  readonly #listeners = new Set<() => void>();

  get(sessionId: string | null | undefined): PromptAnnotation[] {
    if (!sessionId) return EMPTY_ANNOTATIONS;
    return this.#bySession.get(sessionId) ?? EMPTY_ANNOTATIONS;
  }

  add(sessionId: string, annotation: PromptAnnotation): void {
    const current = this.get(sessionId);
    const index = current.findIndex((item) => item.id === annotation.id);
    const next = index >= 0
      ? current.map((item, itemIndex) => itemIndex === index ? annotation : item)
      : [...current, annotation];
    this.#bySession.set(sessionId, next);
    this.#emit();
  }

  update(
    sessionId: string,
    annotationId: string,
    patch: Partial<Pick<PromptAnnotation, "comment" | "text" | "browser" | "browser_region">>,
  ): void {
    const current = this.get(sessionId);
    let changed = false;
    const next = current.map((annotation) => {
      if (annotation.id !== annotationId) return annotation;
      changed = true;
      return { ...annotation, ...patch };
    });
    if (!changed) return;
    this.#bySession.set(sessionId, next);
    this.#emit();
  }

  remove(sessionId: string, annotationId: string): void {
    const current = this.get(sessionId);
    const next = current.filter((annotation) => annotation.id !== annotationId);
    if (next.length === current.length) return;
    if (next.length === 0) this.#bySession.delete(sessionId);
    else this.#bySession.set(sessionId, next);
    this.#emit();
  }

  clear(sessionId: string): void {
    if (!this.#bySession.delete(sessionId)) return;
    this.#emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  resetForTests(): void {
    this.#bySession.clear();
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

export const promptAnnotationStore = new PromptAnnotationStore();

export function usePromptAnnotations(
  sessionId: string | null | undefined,
): PromptAnnotation[] {
  return useSyncExternalStore(
    promptAnnotationStore.subscribe,
    () => promptAnnotationStore.get(sessionId),
    () => EMPTY_ANNOTATIONS,
  );
}
