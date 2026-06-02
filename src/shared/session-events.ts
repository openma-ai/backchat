/**
 * Wire types for the renderer ⇄ main session channel.
 *
 * Kept in `src/shared/` so the preload bridge, the main-process SessionManager,
 * and the renderer all import from one source. Tweaks here are protocol
 * changes — tag with a comment explaining the migration when needed.
 */

export interface SessionStartParams {
  /** Stable id chosen by the renderer (uuid). Used as map key + spawn cwd
   *  basename. The renderer is free to fire `start` for the same id at the
   *  top of every turn — the manager re-acks idempotently. */
  session_id: string;
  /** Canonical agent id from the registry (claude-acp / codex-acp / ...). */
  agent_id: string;
  /** Override the spawn cwd. When omitted, the manager creates one under
   *  userData/sessions/<session_id>/. Workspaces will pass the workspace's
   *  root_path here in Phase 4. */
  cwd?: string;
  /** Provide an existing ACP-side session id to resume conversation history
   *  via `session/load`. Falls back to `session/new` when the agent doesn't
   *  advertise the loadSession capability. */
  resume?: { acp_session_id: string };
}

export interface SessionPromptParams {
  session_id: string;
  /** Stable per-turn id. Used to route `session.event` and `session.complete`
   *  back to the right turn in the UI. */
  turn_id: string;
  text: string;
}

/** Outbound (main → renderer) wire shapes. The renderer subscribes via
 *  `window.openma.onSessionEvent(handler)` (preload). */
export type SessionEventOut =
  | {
      type: "session.ready";
      session_id: string;
      acp_session_id: string;
      agent_id: string;
      cwd: string;
    }
  | {
      type: "session.event";
      session_id: string;
      turn_id: string;
      /** Raw ACP `SessionUpdate` (8 main variants) or a host-side synthetic
       *  like `{ type: "requestPermission", … }`. The renderer's reducer
       *  branches on the discriminator. */
      event: unknown;
    }
  | { type: "session.complete"; session_id: string; turn_id: string }
  | { type: "session.error"; session_id: string; turn_id?: string; message: string }
  | { type: "session.disposed"; session_id: string };
