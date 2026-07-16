import { useSyncExternalStore } from "react";

import type { PromptAttachment } from "@shared/session-events.js";

export interface ComposerInsertion {
  id: string;
  attachments: PromptAttachment[];
}

const EMPTY_INSERTIONS: ComposerInsertion[] = [];

class ComposerInsertionStore {
  readonly #bySession = new Map<string, ComposerInsertion[]>();
  readonly #listeners = new Set<() => void>();

  get(sessionId: string | null | undefined): ComposerInsertion[] {
    if (!sessionId) return EMPTY_INSERTIONS;
    return this.#bySession.get(sessionId) ?? EMPTY_INSERTIONS;
  }

  add(sessionId: string, insertion: ComposerInsertion): void {
    const current = this.get(sessionId);
    const index = current.findIndex((item) => item.id === insertion.id);
    const next = index >= 0
      ? current.map((item, itemIndex) => itemIndex === index ? insertion : item)
      : [...current, insertion];
    this.#bySession.set(sessionId, next);
    this.#emit();
  }

  consume(sessionId: string, insertionIds: string[]): void {
    const ids = new Set(insertionIds);
    const current = this.get(sessionId);
    const next = current.filter((item) => !ids.has(item.id));
    if (next.length === current.length) return;
    if (next.length === 0) this.#bySession.delete(sessionId);
    else this.#bySession.set(sessionId, next);
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

export const composerInsertionStore = new ComposerInsertionStore();

export function useComposerInsertions(
  sessionId: string | null | undefined,
): ComposerInsertion[] {
  return useSyncExternalStore(
    composerInsertionStore.subscribe,
    () => composerInsertionStore.get(sessionId),
    () => EMPTY_INSERTIONS,
  );
}
