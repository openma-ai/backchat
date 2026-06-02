/**
 * Renderer-facing surface exposed via contextBridge. Renderer code reads this
 * type via `window.openma`. Main owns the implementation; preload forwards.
 *
 * Keep narrow: every method is a permission boundary.
 */

import type {
  SessionEventOut,
  SessionPromptParams,
  SessionStartParams,
} from "./session-events.js";

export interface AgentInfo {
  id: string;
  label: string;
  command: string;
  /** Human-readable. Set when the agent's binary isn't on PATH. */
  installHint?: string;
  homepage?: string;
  featured?: boolean;
  /** Whether the binary is actually on PATH right now. detectAll-derived. */
  detected: boolean;
}

export interface OpenmaApi {
  /** Smoke test for the IPC channel. */
  ping(msg: string): Promise<string>;

  /** All known ACP agents merged from the official registry + overlay,
   *  flagged by detection. Renderer uses this to power the agent picker. */
  agentsList(): Promise<AgentInfo[]>;

  sessionStart(p: SessionStartParams): Promise<void>;
  sessionPrompt(p: SessionPromptParams): Promise<void>;
  sessionCancel(p: { session_id: string; turn_id: string }): Promise<void>;
  sessionDispose(p: { session_id: string; remove_cwd?: boolean }): Promise<void>;

  /** Re-emit `session.ready` for every alive session. Renderer calls this
   *  on mount after a reload. */
  sessionAnnounce(): Promise<void>;

  /** Subscribe to push events. Returns an unsubscribe fn. */
  onSessionEvent(handler: (e: SessionEventOut) => void): () => void;
}

declare global {
  interface Window {
    openma: OpenmaApi;
  }
}
