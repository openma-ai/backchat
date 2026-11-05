import type { Turn } from "./session-types";

const EMPTY_TURNS: readonly Turn[] = Object.freeze([]);

/** The canonical turn Map plus a session index. Keep all writes at the Map
 * boundary so replay, optimistic ID replacement, native children and deletion
 * cannot leave the index behind. Values are shared with the canonical Map:
 * in-place streaming updates remain immediately visible without a publish.
 *
 * `arrayForSession` returns a cached registration-order array invalidated on
 * any write that touches that session, so hot transcript selectors can keep a
 * stable reference across unchanged reads without rescanning. */
export class SessionTurnMap extends Map<string, Turn> {
  #bySession = new Map<string, Map<string, Turn>>();
  #arrays = new Map<string, Turn[]>();

  constructor() {
    super();
  }

  override set(id: string, turn: Turn): this {
    const previous = this.get(id);
    super.set(id, turn);
    if (previous && previous.sessionId !== turn.sessionId) {
      this.#removeFromSession(previous.sessionId, id);
      // Rehoming an existing turn must retain its *global* registration order,
      // including when the destination already has interleaved turns. This is
      // a rare identity-reconciliation path, not the per-event fast path.
      const destination = new Map<string, Turn>();
      for (const [key, value] of this) {
        if (value.sessionId === turn.sessionId) destination.set(key, value);
      }
      this.#bySession.set(turn.sessionId, destination);
      this.#arrays.delete(turn.sessionId);
    } else {
      let session = this.#bySession.get(turn.sessionId);
      if (!session) {
        session = new Map();
        this.#bySession.set(turn.sessionId, session);
      }
      session.set(id, turn);
      this.#arrays.delete(turn.sessionId);
    }
    return this;
  }

  override delete(id: string): boolean {
    const turn = this.get(id);
    if (!super.delete(id)) return false;
    this.#removeFromSession(turn!.sessionId, id);
    return true;
  }

  override clear(): void {
    super.clear();
    this.#bySession.clear();
    this.#arrays.clear();
  }

  #removeFromSession(sessionId: string, id: string): void {
    const session = this.#bySession.get(sessionId);
    if (!session) return;
    session.delete(id);
    this.#arrays.delete(sessionId);
    if (session.size === 0) this.#bySession.delete(sessionId);
  }

  valuesForSession(sessionId: string): Iterable<Turn> {
    return this.#bySession.get(sessionId)?.values() ?? [];
  }

  /** Stable until the next write that touches `sessionId`. */
  arrayForSession(sessionId: string): readonly Turn[] {
    const cached = this.#arrays.get(sessionId);
    if (cached) return cached;
    const session = this.#bySession.get(sessionId);
    // Missing/disposed IDs must not accumulate empty cache entries as users
    // navigate. Only sessions that still own turns retain an array.
    if (!session) return EMPTY_TURNS;
    const next = [...session.values()];
    this.#arrays.set(sessionId, next);
    return next;
  }
}
