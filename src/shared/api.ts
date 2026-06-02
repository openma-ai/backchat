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
import type { Settings } from "./settings.js";

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

/** Public shape of a persisted session row. Mirrors PersistedSession in
 *  src/main/sql-store.ts. */
export interface PersistedSessionInfo {
  id: string;
  agent_id: string;
  cwd: string;
  acp_session_id: string;
  title: string;
  last_used_at: number;
  created_at: number;
  archived_at: number | null;
}

/** Public shape of one persisted event. `data` is JSON-encoded text — the
 *  renderer parses on use. */
export interface PersistedEventInfo {
  seq: number;
  session_id: string;
  type: string;
  data: string;
  ts: number;
}

/** Permission ask pushed from the agent. Renderer surfaces a modal with
 *  one button per `options` entry; on click, calls permissionRespond. */
export interface PermissionAskInfo {
  requestId: string;
  sessionId: string;
  /** Opaque ACP ToolCallUpdate — we render `title` / `kind` / `rawInput`. */
  toolCall: unknown;
  options: Array<{
    optionId: string;
    name: string;
    /** ACP PermissionOptionKind — drives icon + button color. */
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
  }>;
}

/** Outbound write-approval ask for out-of-cwd writes. Shown with a tiny
 *  diff preview in the modal. */
export interface FsWriteAskInfo {
  requestId: string;
  sessionId: string;
  path: string;
  byteSize: number;
  /** First ~1 KB of the proposed content. */
  newPreview: string;
  /** First ~1 KB of the current file (empty if the file does not exist). */
  oldPreview: string;
}

export interface TerminalOutputFrame {
  sessionId: string;
  terminalId: string;
  chunk: string;
}

export interface TerminalExitFrame {
  sessionId: string;
  terminalId: string;
  exitCode: number | null;
  signal: string | null;
}

/** A single Cmd+K search hit. Snippet uses ⁨ ⁩ Unicode invisible brackets
 *  around matched tokens (FTS5 default markers; we substitute them with
 *  <mark> at render time). */
export interface SearchHitInfo {
  session_id: string;
  session_title: string;
  agent_id: string;
  seq: number;
  type: string;
  ts: number;
  snippet: string;
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

  /** List persisted sessions (most-recent first, archived hidden). Used by
   *  the renderer on boot to rebuild the sidebar from disk before any
   *  live session.ready arrives. */
  sessionsList(limit?: number): Promise<PersistedSessionInfo[]>;

  /** Replay the event log for a persisted session, in seq order. Renderer
   *  feeds these back into its in-memory store to reconstruct turns. */
  sessionsLoadHistory(sessionId: string): Promise<PersistedEventInfo[]>;

  /** Full-text search across persisted chat prose. Used by Cmd+K's
   *  Search section. Empty query returns []. */
  sessionsSearch(query: string, limit?: number): Promise<SearchHitInfo[]>;

  /** Subscribe to push events. Returns an unsubscribe fn. */
  onSessionEvent(handler: (e: SessionEventOut) => void): () => void;

  // ----- Settings -----

  settingsGet(): Promise<Settings>;
  /** Shallow merge — top-level keys replaced wholesale. */
  settingsPatch(partial: Partial<Settings>): Promise<void>;
  /** Notified on every patch. Returns an unsubscribe fn. */
  onSettingsChanged(handler: (s: Settings) => void): () => void;

  // ----- Brokers (Phase 6) -----

  /** Subscribe to permission asks pushed from the main process. Modal
   *  decides; call `permissionRespond` with the chosen optionId (or null
   *  for cancel). */
  onPermissionRequest(handler: (ask: PermissionAskInfo) => void): () => void;
  permissionRespond(requestId: string, optionId: string | null): Promise<void>;

  /** Out-of-cwd write approval flow. */
  onFsWriteApproval(handler: (ask: FsWriteAskInfo) => void): () => void;
  fsApprovalRespond(requestId: string, approved: boolean): Promise<void>;

  /** Per-terminal live output. */
  onTerminalOutput(handler: (frame: TerminalOutputFrame) => void): () => void;
  onTerminalExit(handler: (frame: TerminalExitFrame) => void): () => void;

  /** Native menu fired a navigate request — payload is the route path. */
  onMenuNavigate(handler: (path: string) => void): () => void;
  /** Native menu fired a renderer action — payload is "new-chat" |
   *  "command-palette". */
  onMenuAction(handler: (action: string) => void): () => void;
}

declare global {
  interface Window {
    openma: OpenmaApi;
  }
}
