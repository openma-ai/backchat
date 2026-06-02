/**
 * Renderer-side session store. In-memory only — no SQLite yet, that lands in
 * Phase 4. The store owns:
 *
 *   - `sessions`:  metadata for every session the user has opened in this
 *                  window (id, agent, cwd, ready, last activity).
 *   - `byTurn`:    map of turn_id → { sessionId, events[] } for live + recent
 *                  turns. Events are appended as `session.event` arrives over
 *                  IPC; the chat view reads from here.
 *   - `activeId`:  the session currently shown in the right pane.
 *
 * The store is a plain class wrapped in a context — TanStack Query handles
 * cross-window concerns later; for now a simple `useSyncExternalStore`
 * subscription keeps Phase 3 small.
 *
 * Tool-call updates apply IN PLACE via `toolCallId` patch semantics (ACP's
 * `tool_call_update` is a partial). Plan updates REPLACE entire entries.
 */

import { useSyncExternalStore } from "react";
import type { SessionEventOut } from "@shared/session-events.js";

export interface SessionRow {
  id: string;
  agent_id: string;
  cwd: string;
  acp_session_id: string;
  /** UI label. Phase 3 derives from agent + short id; Phase 4 lets the user
   *  rename, persisting to SQLite. */
  label: string;
  /** Lifecycle:
   *    "draft"     → empty session, no IPC fired yet. Created by clicking
   *                  "+ New chat"; flips to "starting" the moment the user
   *                  sends their first prompt.
   *    "starting"  → session.start IPC fired; awaiting session.ready.
   *    "ready"     → no in-flight turn.
   *    "running"   → a turn is streaming.
   *    "errored"   → start failed (unknown agent, missing binary, ACP
   *                  handshake refused). Surface lastError, ask user to
   *                  start a new one.
   *    "disposed"  → main process killed the child. We drop the row from
   *                  the store soon after this state.
   */
  status: "draft" | "starting" | "ready" | "running" | "errored" | "disposed";
  lastError?: string;
  createdAt: number;
  /** turn_id of the in-flight prompt, if any. */
  activeTurnId?: string;
}

export interface TurnEvent {
  /** Raw ACP `sessionUpdate` payload OR a synthetic event from the runtime
   *  (`{ type: "requestPermission", … }`). Discriminated by either
   *  `sessionUpdate` (ACP) or `type` (synthetic). */
  payload: unknown;
  receivedAt: number;
}

/** Lightweight typed deltas emitted on the per-turn STREAM channel — the
 *  one consumed by the DOM-mutating <StreamingMarkdown> component. We never
 *  push these through React state; each delta is a direct callback into the
 *  subscriber. React only sees the structural store updates (turn start,
 *  tool change, complete) via the regular `#version` channel.
 *
 *  This is the load-bearing performance trick — see Phase 5.1 design notes.
 *  Without it, streaming a multi-KB markdown response into React state
 *  forces a full reconciliation on every chunk and you get the visible
 *  "stall" Claude Desktop / Alma avoid. */
export type StreamDelta =
  | { kind: "assistant"; text: string }
  | { kind: "thought"; text: string };

export type StreamSubscriber = (d: StreamDelta) => void;

export interface Turn {
  id: string;
  sessionId: string;
  promptText: string;
  events: TurnEvent[];
  /** Accumulated assistant text. The streaming channel pushes deltas into a
   *  DOM-mutating renderer; this string is the SAME content but kept in JS
   *  so a late-mounting component (e.g. user scrolls back into the turn)
   *  can pick up the current state without re-running every event. */
  assistantText: string;
  thoughtText: string;
  status: "running" | "complete" | "error" | "cancelled";
  errorMessage?: string;
  startedAt: number;
  endedAt?: number;
}

class SessionStore {
  #sessions = new Map<string, SessionRow>();
  #turns = new Map<string, Turn>();
  #activeId: string | null = null;
  #listeners = new Set<() => void>();
  /** Snapshot version — bumps on every mutation. Lets useSyncExternalStore
   *  return a stable === reference when nothing changed. */
  #version = 0;
  /** Cached snapshots keyed by version — useSyncExternalStore calls
   *  `getSnapshot()` on every render and demands identity-stable results
   *  between mutations. Without caching, `list()`-style selectors return a
   *  fresh array each call and React enters an infinite re-render loop
   *  (#185). The cache is keyed by both the version AND the selector
   *  reference so multiple components reading different slices each get
   *  their own stable result. */
  #snapshotCache = new WeakMap<(s: SessionStore) => unknown, { version: number; value: unknown }>();
  /** Per-turn stream subscribers — bypass React. When a chunk arrives we
   *  mutate `Turn.assistantText` in place (no immutable replacement, no
   *  version bump) AND broadcast the delta here. The <StreamingMarkdown>
   *  component is the only subscriber; it calls `parser_write` on a ref'd
   *  div and React stays asleep. */
  #streamSubscribers = new Map<string, Set<StreamSubscriber>>();

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  /** Subscribe to the per-turn STREAM channel. The handler fires synchronously
   *  on each chunk; no React render is involved. Use this to drive a
   *  DOM-mutating renderer like streaming-markdown. Returns an unsubscribe
   *  fn. If the turn already has accumulated text by the time you subscribe
   *  (late mount), the current text is replayed once. */
  subscribeTurnStream(turnId: string, h: StreamSubscriber): () => void {
    let set = this.#streamSubscribers.get(turnId);
    if (!set) {
      set = new Set();
      this.#streamSubscribers.set(turnId, set);
    }
    set.add(h);
    // Replay current state — so a late mount can rebuild the rendered DOM
    // from the in-memory accumulator without re-running every event.
    const turn = this.#turns.get(turnId);
    if (turn) {
      if (turn.thoughtText) h({ kind: "thought", text: turn.thoughtText });
      if (turn.assistantText) h({ kind: "assistant", text: turn.assistantText });
    }
    return () => {
      const s = this.#streamSubscribers.get(turnId);
      if (!s) return;
      s.delete(h);
      if (s.size === 0) this.#streamSubscribers.delete(turnId);
    };
  }

  #emitStream(turnId: string, d: StreamDelta) {
    const subs = this.#streamSubscribers.get(turnId);
    if (!subs) return;
    for (const s of subs) s(d);
  }

  getVersion = (): number => this.#version;

  /** Run `selector` against the current store, but only re-evaluate it when
   *  the store has mutated since the last call. Caller (`useSessionStore`)
   *  passes a stable function reference for this to work — otherwise the
   *  WeakMap miss forces re-evaluation every render, which is correct (no
   *  infinite loop) but wasteful. */
  snapshot<T>(selector: (s: SessionStore) => T): T {
    const cached = this.#snapshotCache.get(selector as (s: SessionStore) => unknown);
    if (cached && cached.version === this.#version) return cached.value as T;
    const value = selector(this);
    this.#snapshotCache.set(selector as (s: SessionStore) => unknown, {
      version: this.#version,
      value,
    });
    return value;
  }

  #emit() {
    this.#version++;
    for (const l of this.#listeners) l();
  }

  // ------- Reads -------

  list(): SessionRow[] {
    return [...this.#sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): SessionRow | undefined {
    return this.#sessions.get(id);
  }

  activeId(): string | null {
    return this.#activeId;
  }

  active(): SessionRow | null {
    return this.#activeId ? (this.#sessions.get(this.#activeId) ?? null) : null;
  }

  turnsFor(sessionId: string): Turn[] {
    return [...this.#turns.values()]
      .filter((t) => t.sessionId === sessionId)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  // ------- Mutations called by the UI -------

  setActive(id: string | null): void {
    if (this.#activeId === id) return;
    this.#activeId = id;
    this.#emit();
  }

  /** Cold-create entry point. Pushes a draft session into the store
   *  without firing any IPC — the actual `session.start` happens when the
   *  user submits their first prompt (see promoteDraft). Returns the new
   *  session id so the caller can navigate to /chat/$id. */
  newDraft(): string {
    const id = `sess-${Math.random().toString(36).slice(2, 10)}`;
    this.#sessions.set(id, {
      id,
      agent_id: "",
      cwd: "",
      acp_session_id: "",
      label: "New chat",
      status: "draft",
      createdAt: Date.now(),
    });
    this.#activeId = id;
    this.#emit();
    return id;
  }

  /** Mark a draft as starting — the renderer calls this right before firing
   *  session.start IPC. Lets the UI show "Starting…" before the spawn
   *  actually completes. The agent_id is what the renderer chose (default
   *  from settings); the row persists it so the chat header stays useful
   *  while the bg/acp_session_id catch up via session.ready. */
  promoteDraft(id: string, agent_id: string, label: string): void {
    this.#mutateSession(id, (s) => ({
      ...s,
      agent_id,
      label,
      status: "starting",
    }));
    this.#emit();
  }

  /** Optimistically register a session before `session.ready` lands. Lets the
   *  sidebar render immediately and the chat input go into a sensible
   *  "starting…" disabled state. */
  registerStarting(id: string, agent_id: string, label: string): void {
    if (this.#sessions.has(id)) return;
    this.#sessions.set(id, {
      id,
      agent_id,
      cwd: "",
      acp_session_id: "",
      label,
      status: "starting",
      createdAt: Date.now(),
    });
    this.#emit();
  }

  /** Begin a new turn — store the prompt text so the chat view can render the
   *  user bubble before any agent event arrives. */
  registerTurn(turnId: string, sessionId: string, promptText: string): void {
    this.#turns.set(turnId, {
      id: turnId,
      sessionId,
      promptText,
      events: [],
      assistantText: "",
      thoughtText: "",
      status: "running",
      startedAt: Date.now(),
    });
    this.#mutateSession(sessionId, (s) => ({
      ...s,
      activeTurnId: turnId,
      status: "running",
    }));
    this.#emit();
  }

  /** Replace one row with a new object (immutable update). Keeps React happy
   *  with referential-equality identity tracking — see #snapshotCache and the
   *  comment in apply() below. */
  #mutateSession(id: string, update: (prev: SessionRow) => SessionRow): void {
    const prev = this.#sessions.get(id);
    if (!prev) return;
    this.#sessions.set(id, update(prev));
  }

  // ------- Reducer driven by main → renderer push events -------
  //
  // Every mutation that changes a SessionRow REPLACES the row in the Map
  // with a new object (see `#mutateSession`). Mutating in place would keep
  // `===` row identity and break `useSyncExternalStore`'s shallow change
  // detection — components selecting that row would never re-render even
  // though the underlying `.status` flipped.

  apply(ev: SessionEventOut): void {
    switch (ev.type) {
      case "session.ready": {
        const existing = this.#sessions.get(ev.session_id);
        if (existing) {
          this.#mutateSession(ev.session_id, (s) => ({
            ...s,
            acp_session_id: ev.acp_session_id,
            agent_id: ev.agent_id,
            cwd: ev.cwd,
            status: s.activeTurnId ? "running" : "ready",
            lastError: undefined,
          }));
        } else {
          this.#sessions.set(ev.session_id, {
            id: ev.session_id,
            agent_id: ev.agent_id,
            cwd: ev.cwd,
            acp_session_id: ev.acp_session_id,
            label: `${ev.agent_id} · ${ev.session_id.slice(0, 6)}`,
            status: "ready",
            createdAt: Date.now(),
          });
        }
        if (!this.#activeId) this.#activeId = ev.session_id;
        break;
      }
      case "session.event": {
        const turn = this.#turns.get(ev.turn_id);
        if (!turn) {
          this.#turns.set(ev.turn_id, {
            id: ev.turn_id,
            sessionId: ev.session_id,
            promptText: "",
            events: [{ payload: ev.event, receivedAt: Date.now() }],
            assistantText: "",
            thoughtText: "",
            status: "running",
            startedAt: Date.now(),
          });
          break;
        }

        // Fast path for streaming text — bypass React. assistant_message_chunk
        // and agent_thought_chunk arrive at high frequency (one per token);
        // routing them through React state would force a reconciliation per
        // chunk and visibly stall on long messages. Instead we mutate the
        // turn's accumulator in place and broadcast on the stream channel,
        // which the DOM-mutating <StreamingMarkdown> consumes directly.
        // Crucially this branch DOES NOT call `this.#emit()` — React stays
        // asleep during the stream.
        const ev2 = ev.event as { sessionUpdate?: string; content?: { type?: string; text?: string } } | null;
        const tag = ev2?.sessionUpdate;
        if (tag === "agent_message_chunk" || tag === "agent_thought_chunk") {
          const c = ev2?.content;
          if (c?.type === "text" && typeof c.text === "string" && c.text.length > 0) {
            // In-place mutate (intentional). React doesn't read this field
            // during the stream — only on turn-complete unmount-and-replace
            // — so identity stability is irrelevant here. The savings:
            // tens of thousands of avoided reconciliations per long turn.
            if (tag === "agent_message_chunk") {
              turn.assistantText += c.text;
              this.#emitStream(ev.turn_id, { kind: "assistant", text: c.text });
            } else {
              turn.thoughtText += c.text;
              this.#emitStream(ev.turn_id, { kind: "thought", text: c.text });
            }
            // Append to events log too — used by tools-only fallback
            // renderers and debug inspection. We DO replace the array (not
            // mutate) because React-side tool list reducers still inspect
            // `events` via reduceTurn() for the structural pieces, and
            // they need referential change detection.
            // BUT we don't `#emit` here either; the next structural event
            // (tool_call, plan, complete) carries the bump.
            turn.events = [...turn.events, { payload: ev.event, receivedAt: Date.now() }];
            return;
          }
        }

        // Structural event — replace events array AND bump version so React
        // re-renders the affected turn block.
        this.#turns.set(ev.turn_id, {
          ...turn,
          events: [...turn.events, { payload: ev.event, receivedAt: Date.now() }],
        });
        break;
      }
      case "session.complete": {
        const turn = this.#turns.get(ev.turn_id);
        if (turn) {
          this.#turns.set(ev.turn_id, {
            ...turn,
            status: "complete",
            endedAt: Date.now(),
          });
        }
        this.#mutateSession(ev.session_id, (s) => ({
          ...s,
          activeTurnId: undefined,
          status: "ready",
        }));
        break;
      }
      case "session.error": {
        if (ev.turn_id) {
          const turn = this.#turns.get(ev.turn_id);
          if (turn) {
            this.#turns.set(ev.turn_id, {
              ...turn,
              status: "error",
              errorMessage: ev.message,
              endedAt: Date.now(),
            });
          }
          this.#mutateSession(ev.session_id, (s) => ({ ...s, activeTurnId: undefined }));
        }
        this.#mutateSession(ev.session_id, (s) => ({
          ...s,
          // Session-wide errors (no turn_id) usually mean start failed —
          // unknown agent, missing binary, ACP handshake refused.
          status: ev.turn_id ? s.status : "errored",
          lastError: ev.message,
        }));
        break;
      }
      case "session.disposed": {
        this.#mutateSession(ev.session_id, (s) => ({ ...s, status: "disposed" }));
        if (this.#activeId === ev.session_id) {
          const fallback = [...this.#sessions.values()].find(
            (s) => s.id !== ev.session_id && s.status !== "disposed",
          );
          this.#activeId = fallback?.id ?? null;
        }
        this.#sessions.delete(ev.session_id);
        for (const [tid, turn] of this.#turns) {
          if (turn.sessionId === ev.session_id) this.#turns.delete(tid);
        }
        break;
      }
    }
    this.#emit();
  }
}

export const sessionStore = new SessionStore();

/** Stable top-level selectors — pass these to `useSessionStore` instead of
 *  defining inline arrows. Inline arrows would create a fresh reference
 *  per render and miss the store's snapshot cache. */
export const selectSessions = (s: SessionStore) => s.list();
export const selectActiveId = (s: SessionStore) => s.activeId();
export const selectActive = (s: SessionStore) => s.active();
export const selectTurnsFor = (sessionId: string) => (s: SessionStore) =>
  s.turnsFor(sessionId);

/** Imperative new-draft helper for routes that don't have a hook in scope. */
export function newDraftSession(): string {
  return sessionStore.newDraft();
}

/** React hook — re-renders whenever the store version bumps. Components
 *  request the slice they care about via a selector; results are cached by
 *  version so identity-sensitive comparisons (referential equality) stay
 *  stable between mutations. Pass a STABLE selector reference (one of the
 *  `select*` exports above, or a useMemo'd factory) — inline arrows miss
 *  the cache. */
export function useSessionStore<T>(selector: (s: SessionStore) => T): T {
  return useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.snapshot(selector),
    () => sessionStore.snapshot(selector),
  );
}
