/**
 * Wire types for pair-chat events. Mirrors session-events.ts but kept
 * STRICTLY SEPARATE so single chats never see pair-shaped payloads and
 * vice versa. SessionManager doesn't import this file; PairManager
 * doesn't import session-events. The only crossover is via PairManager's
 * `route(SessionEventOut)` tee which converts member events to
 * `PairEventOut`.
 */

export interface PairStartParams {
  /** Stable pair id chosen by the renderer (uuid). */
  pair_id: string;
  /** One sub-session per agent. Renderer mints these alongside pair_id
   *  so column-to-session mapping is deterministic across reload (grid
   *  column N renders members[N]). */
  members: Array<{ session_id: string; agent_id: string }>;
  /** Optional shared workspace cwd. When set, every member spawns
   *  here (caller accepts that file writes may conflict). When
   *  omitted, each sub-session gets its own
   *  ~/.openma/sessions/<session_id>/ via session-cwd auto-allocation. */
  workspace_cwd?: string;
}

export interface PairPromptParams {
  pair_id: string;
  /** Shared per-turn id. Every member's stream tags events with this
   *  same turn_id so the renderer groups them under one row in the
   *  grid timeline. */
  turn_id: string;
  text: string;
}

/** Outbound (main → renderer) pair-chat events. Pushed on a dedicated
 *  IPC channel so single-chat code never has to filter them out. */
export type PairEventOut =
  | {
      type: "pair.ready";
      pair_id: string;
      /** Each member's per-session ready info, in the order they were
       *  started. Index matches PairStartParams.members. */
      members: Array<{
        session_id: string;
        agent_id: string;
        acp_session_id: string;
        cwd: string;
      }>;
    }
  | {
      type: "pair.event";
      pair_id: string;
      /** Which sub-session emitted this — drives column routing. */
      member_session_id: string;
      turn_id: string;
      event: unknown;
    }
  | {
      type: "pair.complete";
      pair_id: string;
      member_session_id: string;
      turn_id: string;
    }
  | {
      type: "pair.error";
      pair_id: string;
      member_session_id: string;
      turn_id?: string;
      message: string;
    }
  | { type: "pair.disposed"; pair_id: string };
