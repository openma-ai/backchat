/**
 * PairManager — multi-agent chat coordinator.
 *
 * Design: PairManager is a SIBLING of SessionManager, both owned by
 * ipc.ts (the composition root). They communicate via a thin contract:
 *
 *   - SessionManager owns ALL sessions, including "currently grouped
 *     into a pair" sub-sessions. It doesn't know pair-chats exist.
 *   - PairManager holds a reference to SessionManager and calls its
 *     1:1 API (start/prompt/cancel/dispose) when fanning out a pair
 *     operation. It also remembers which session_ids are currently
 *     grouped into which pair_id.
 *   - In ipc.ts, SessionManager.send is wrapped with a tee that asks
 *     PairManager "do you own this session_id?". If yes, the event
 *     is reshaped into PairEventOut and routed to pairSink. If no, the
 *     event passes through to singleSink unchanged.
 *
 * The siblings arrangement supports later "split" operations: e.g.
 * "graduate this codex column out of the pair into a standalone chat"
 * is implemented as `pairManager.releaseMember(pair_id, session_id)`,
 * which simply removes the (session_id -> pair_id) binding from
 * PairManager and clears the SQL row's pair_id. SessionManager is
 * unaffected — the session goes on running, but the tee now classifies
 * its events as single-chat and they appear in the sidebar.
 */

import type { SessionManager } from "./session-manager.js";
import type { SessionEventOut, SessionStartParams, SessionPromptParams } from "../shared/session-events.js";
import type {
  PairEventOut,
  PairPromptParams,
  PairStartParams,
} from "../shared/pair-events.js";
import {
  listPairMembers,
  setPairTitleIfEmpty,
  touchPairSession,
  upsertPairSession,
  upsertSession,
} from "./sql-store.js";

export type PairSink = (msg: PairEventOut) => void;

export interface PairManagerDeps {
  /** The single-session manager. PairManager calls its 1:1 API but
   *  never modifies it. Must be the same instance whose `send` was
   *  wired through `PairManager.routeOrPassthrough`. */
  sessionManager: SessionManager;
  /** Where pair-level events go. */
  pairSink: PairSink;
}

interface ActivePair {
  pair_id: string;
  /** Sub-session ids that belong to this pair, in display order. */
  member_session_ids: string[];
  /** Per-member metadata stashed so pair.ready can echo it back
   *  to the renderer once every member has acked. */
  pendingReady: Map<
    string,
    { agent_id: string; acp_session_id?: string; cwd?: string }
  >;
}

export class PairManager {
  #sessionManager: SessionManager;
  #pairSink: PairSink;
  /** Reverse index: session_id -> pair_id. Populated on startPair
   *  before SessionManager.start() fires; used by `routeOrPassthrough`
   *  to classify outbound session events. */
  #subToPair = new Map<string, string>();
  #pairs = new Map<string, ActivePair>();

  constructor(deps: PairManagerDeps) {
    this.#sessionManager = deps.sessionManager;
    this.#pairSink = deps.pairSink;
  }

  /** Tee entry point. The composition root wraps SessionManager's
   *  `send` with a call to this; we either consume the event (if the
   *  session belongs to a pair) or hand it back to the passthrough
   *  sink for normal single-chat routing.
   *
   *  Returns `true` when consumed, `false` when not — caller can
   *  pass `false` events to the default sink. (We could call the
   *  passthrough sink directly, but returning a flag keeps this
   *  module from knowing where non-pair events go.) */
  routeOrPassthrough(msg: SessionEventOut): boolean {
    const pair_id = this.#subToPair.get(msg.session_id);
    if (!pair_id) return false;
    this.#handleSubEvent(pair_id, msg);
    return true;
  }

  #handleSubEvent(pair_id: string, msg: SessionEventOut): void {
    const pair = this.#pairs.get(pair_id);
    if (!pair) {
      // Pair was disposed between session-event emission and arrival.
      // Drop quietly — the renderer already cleaned up.
      return;
    }
    switch (msg.type) {
      case "session.ready": {
        const pending = pair.pendingReady.get(msg.session_id);
        if (pending) {
          pending.acp_session_id = msg.acp_session_id;
          pending.cwd = msg.cwd;
        }
        // Fire pair.ready only when ALL members have acked. Avoids
        // partial-grid render while one agent is still spawning.
        const allReady = [...pair.pendingReady.values()].every(
          (m) => m.acp_session_id !== undefined,
        );
        if (allReady) {
          this.#pairSink({
            type: "pair.ready",
            pair_id,
            members: pair.member_session_ids.map((sid) => {
              const m = pair.pendingReady.get(sid)!;
              return {
                session_id: sid,
                agent_id: m.agent_id,
                acp_session_id: m.acp_session_id ?? "",
                cwd: m.cwd ?? "",
              };
            }),
          });
        }
        return;
      }
      case "session.event":
        this.#pairSink({
          type: "pair.event",
          pair_id,
          member_session_id: msg.session_id,
          turn_id: msg.turn_id,
          event: msg.event,
        });
        return;
      case "session.complete":
        this.#pairSink({
          type: "pair.complete",
          pair_id,
          member_session_id: msg.session_id,
          turn_id: msg.turn_id,
        });
        return;
      case "session.error":
        this.#pairSink({
          type: "pair.error",
          pair_id,
          member_session_id: msg.session_id,
          turn_id: msg.turn_id,
          message: msg.message,
        });
        return;
      case "session.disposed":
        // One member died. We don't auto-dispose the whole pair —
        // user might still want to interact with surviving members.
        // Surface as pair.error with turn_id undefined; the renderer
        // can show "<agent> 已断开" in that column.
        this.#pairSink({
          type: "pair.error",
          pair_id,
          member_session_id: msg.session_id,
          message: "session disposed",
        });
        return;
    }
  }

  /** Spin up every member of a pair. Each member is just a normal
   *  single-session start with the standard SessionStartParams; the
   *  pair binding is in our in-memory map + the SQL pair_sessions
   *  row, not in SessionManager. */
  async startPair(p: PairStartParams): Promise<void> {
    // Idempotent: if pair is already alive, no-op.
    if (this.#pairs.has(p.pair_id)) return;

    // Persist pair row first so a crash mid-start leaves a recoverable
    // row in the db.
    upsertPairSession({
      id: p.pair_id,
      workspace_cwd: p.workspace_cwd ?? "",
    });

    const pair: ActivePair = {
      pair_id: p.pair_id,
      member_session_ids: p.members.map((m) => m.session_id),
      pendingReady: new Map(
        p.members.map((m) => [m.session_id, { agent_id: m.agent_id }]),
      ),
    };
    this.#pairs.set(p.pair_id, pair);
    // Register sub→pair mapping BEFORE spawning so the tee classifies
    // the first session.ready correctly.
    for (const m of p.members) this.#subToPair.set(m.session_id, p.pair_id);

    // Persist each member row with pair_id so listSessionsForSidebar
    // hides them (it's the SQL contract that the sub rows are
    // sidebar-invisible).
    for (const m of p.members) {
      upsertSession({
        id: m.session_id,
        agent_id: m.agent_id,
        cwd: p.workspace_cwd ?? "",
        pair_id: p.pair_id,
      });
    }

    // Fan-out spawn. Parallel — independent processes, no ordering
    // requirement. allSettled rather than all so one failure doesn't
    // unwind the others; SessionManager emits session.error which our
    // tee already converts to pair.error.
    await Promise.allSettled(
      p.members.map((m) => {
        const start: SessionStartParams = {
          session_id: m.session_id,
          agent_id: m.agent_id,
          ...(p.workspace_cwd ? { cwd: p.workspace_cwd } : {}),
        };
        return this.#sessionManager.start(start);
      }),
    );
  }

  /** Fan a single user prompt out to every member with the same
   *  turn_id. Each member runs its own stream concurrently. */
  async promptPair(p: PairPromptParams): Promise<void> {
    const pair = this.#pairs.get(p.pair_id);
    if (!pair) {
      this.#pairSink({
        type: "pair.error",
        pair_id: p.pair_id,
        member_session_id: "",
        turn_id: p.turn_id,
        message: "no such pair",
      });
      return;
    }
    // Sidebar bump for the pair itself.
    touchPairSession(p.pair_id);
    setPairTitleIfEmpty(p.pair_id, derivePromptLabel(p.text));
    await Promise.allSettled(
      pair.member_session_ids.map((sid) => {
        const sp: SessionPromptParams = {
          session_id: sid,
          turn_id: p.turn_id,
          text: p.text,
        };
        return this.#sessionManager.prompt(sp);
      }),
    );
  }

  /** Cancel an in-flight turn across all members of a pair. */
  cancelPair(pair_id: string, turn_id: string): void {
    const pair = this.#pairs.get(pair_id);
    if (!pair) return;
    for (const sid of pair.member_session_ids) {
      this.#sessionManager.cancel(sid, turn_id);
    }
  }

  /** Dispose every member, drop pair from the index. */
  async disposePair(pair_id: string): Promise<void> {
    const pair = this.#pairs.get(pair_id);
    if (!pair) return;
    await Promise.allSettled(
      pair.member_session_ids.map((sid) =>
        this.#sessionManager.dispose(sid),
      ),
    );
    for (const sid of pair.member_session_ids) this.#subToPair.delete(sid);
    this.#pairs.delete(pair_id);
    this.#pairSink({ type: "pair.disposed", pair_id });
  }

  /** Detach a member from the pair without disposing it. The
   *  underlying SessionManager session keeps running; the tee stops
   *  classifying it as a pair member, so its events flow through as
   *  normal single-chat events and the session shows up in the
   *  sidebar (SQL pair_id is cleared too).
   *
   *  Used by the future "split this column out as a standalone chat"
   *  affordance — the entire point of keeping PairManager and
   *  SessionManager as siblings rather than nested. */
  releaseMember(pair_id: string, session_id: string): void {
    const pair = this.#pairs.get(pair_id);
    if (!pair) return;
    const idx = pair.member_session_ids.indexOf(session_id);
    if (idx < 0) return;
    pair.member_session_ids.splice(idx, 1);
    pair.pendingReady.delete(session_id);
    this.#subToPair.delete(session_id);
    // Persist: clear pair_id so the session row becomes sidebar-
    // visible. Title / acp_session_id / cwd are preserved by the
    // upsert's COALESCE behavior.
    upsertSession({
      id: session_id,
      agent_id: "", // ignored by COALESCE-style upsert when row exists
      cwd: "",
      pair_id: null,
    });
    // If that was the last member, dispose the pair shell too.
    if (pair.member_session_ids.length === 0) {
      this.#pairs.delete(pair_id);
      this.#pairSink({ type: "pair.disposed", pair_id });
    }
  }

  /** Re-announce alive pairs — used by renderer mount handshake.
   *  Single-session announceAll is the caller's responsibility. */
  announcePairs(): void {
    for (const pair of this.#pairs.values()) {
      const allReady = [...pair.pendingReady.values()].every(
        (m) => m.acp_session_id !== undefined,
      );
      if (!allReady) continue;
      this.#pairSink({
        type: "pair.ready",
        pair_id: pair.pair_id,
        members: pair.member_session_ids.map((sid) => {
          const m = pair.pendingReady.get(sid)!;
          return {
            session_id: sid,
            agent_id: m.agent_id,
            acp_session_id: m.acp_session_id ?? "",
            cwd: m.cwd ?? "",
          };
        }),
      });
    }
  }

  /** Restore an in-memory pair from SQL on first request (mount-time
   *  rehydration). Doesn't spawn any children — that happens on the
   *  next startPair. Just makes the renderer aware the pair exists. */
  hydrateFromSql(pair_id: string): boolean {
    if (this.#pairs.has(pair_id)) return true;
    const members = listPairMembers(pair_id);
    if (members.length === 0) return false;
    const pair: ActivePair = {
      pair_id,
      member_session_ids: members.map((m) => m.id),
      pendingReady: new Map(
        members.map((m) => [
          m.id,
          {
            agent_id: m.agent_id,
            acp_session_id: m.acp_session_id || undefined,
            cwd: m.cwd || undefined,
          },
        ]),
      ),
    };
    this.#pairs.set(pair_id, pair);
    for (const m of members) this.#subToPair.set(m.id, pair_id);
    return true;
  }
}

/** Mirrors SessionManager.derivePromptLabel — same 40-char truncation. */
function derivePromptLabel(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split(/\r?\n/)[0]!;
  if (firstLine.length <= 40) return firstLine;
  return firstLine.slice(0, 39).trimEnd() + "…";
}
