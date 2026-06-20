/**
 * Renderer-facing surface exposed via contextBridge. Renderer code reads this
 * type via `window.backchat`. Main owns the implementation; preload forwards.
 *
 * Keep narrow: every method is a permission boundary.
 */

import type {
  PromptAttachment,
  SessionEventOut,
  SessionPromptParams,
  SessionSetConfigOptionParams,
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
  /** Wall-clock ms the user pinned this row, or null when not pinned.
   *  Older db files (pre-pin) have the column present but null. */
  pinned_at: number | null;
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

/** UI metadata for a pair-chat group. The members are still ordinary
 *  sessions; this row only tells the renderer to show them together. */
export interface PersistedPairInfo {
  id: string;
  title: string;
  workspace_cwd: string;
  last_used_at: number;
  created_at: number;
  archived_at: number | null;
  pinned_at: number | null;
  members: PersistedSessionInfo[];
}

export interface PairSaveParams {
  pair_id: string;
  title?: string;
  workspace_cwd?: string;
  members: Array<{
    session_id: string;
    agent_id: string;
    cwd?: string;
  }>;
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

/** What `acpAuthMethods` returns — the agent's `initialize.authMethods`
 *  reshaped for the Settings sign-in picker. */
export interface AcpAuthMethodsResult {
  /** initialize.agentInfo.title || .name, or null if the agent didn't
   *  identify itself. Settings uses it as a friendly label
   *  ("Gemini CLI 登录"). */
  agentName: string | null;
  methods: ReadonlyArray<{
    id: string;
    name: string;
    description?: string | null;
    /** ACP method variant — "env_var" / "terminal" / undefined for
     *  the default "agent" type. UI may render env_var differently
     *  (input field for the value instead of a button), but the
     *  first pass just shows a button for every method. */
    type?: string;
  }>;
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

export interface BackchatApi {
  /** Smoke test for the IPC channel. */
  ping(msg: string): Promise<string>;

  /** All known ACP agents merged from the official registry + overlay,
   *  flagged by detection. Renderer uses this to power the agent picker. */
  agentsList(): Promise<AgentInfo[]>;

  /** Probe an ACP agent for the auth methods it advertises on
   *  initialize. Settings → Agents calls this to render a sign-in
   *  picker (one button per method). Throws if the agent isn't on
   *  PATH / can't be spawned. */
  acpAuthMethods(agentId: string): Promise<AcpAuthMethodsResult>;
  /** Run the agent's signin sub-flow for the chosen methodId
   *  (OAuth browser handoff, API-key validation, ...). Resolves on
   *  success; rejects with the agent's raw error on failure. */
  acpAuthenticate(agentId: string, methodId: string): Promise<void>;

  sessionStart(p: SessionStartParams): Promise<void>;
  sessionPrompt(p: SessionPromptParams): Promise<void>;
  sessionSetConfigOption(p: SessionSetConfigOptionParams): Promise<void>;
  sessionCancel(p: { session_id: string; turn_id: string }): Promise<void>;
  sessionDispose(p: { session_id: string; remove_cwd?: boolean }): Promise<void>;

  /** Re-emit `session.ready` for every alive session. Renderer calls this
   *  on mount after a reload. */
  sessionAnnounce(): Promise<void>;

  /** Pair-chat runtime API kept for old pair sessions. The current UI
   *  path stores only pair metadata and prompts each member through the
   *  normal session API. */
  pairStart(p: import("./pair-events.js").PairStartParams): Promise<void>;
  pairPrompt(p: import("./pair-events.js").PairPromptParams): Promise<void>;
  pairCancel(p: { pair_id: string; turn_id: string }): Promise<void>;
  pairDispose(p: { pair_id: string }): Promise<void>;
  /** Detach a member from the pair without disposing it. The
   *  underlying session keeps running and re-appears as a single
   *  chat in the sidebar. */
  pairReleaseMember(p: { pair_id: string; session_id: string }): Promise<void>;
  onPairEvent(
    handler: (ev: import("./pair-events.js").PairEventOut) => void,
  ): () => void;
  /** SQLite-backed pair UI metadata. The pair row groups otherwise
   *  ordinary sessions for renderer layout/sidebar purposes. */
  pairsList(): Promise<PersistedPairInfo[]>;
  pairSave(p: PairSaveParams): Promise<void>;

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

  /** Set/clear the "pinned to top of sidebar" flag. Pinned sessions
   *  appear in a separate section above the regular Chats list,
   *  ordered by pinned_at desc. */
  sessionsPin(p: { session_id: string }): Promise<void>;
  sessionsUnpin(p: { session_id: string }): Promise<void>;
  /** Archive hides a session from the sidebar. The row + events stay
   *  in SQLite so Search can find it and the user can unarchive
   *  later. Does NOT dispose the ACP child (in case of unarchive). */
  sessionsArchive(p: { session_id: string }): Promise<void>;
  sessionsUnarchive(p: { session_id: string }): Promise<void>;
  /** Return every archived session row, newest archive first. The
   *  Sidebar hides these; Settings → Archive surfaces them so the
   *  user can restore or hard-delete. */
  sessionsListArchived(): Promise<PersistedSessionInfo[]>;
  /** Hard-delete a session. Removes the SQL row (events cascade) and
   *  the on-disk session dir under `~/.openma/sessions/<id>/`. Caller
   *  should confirm with the user first — this is irreversible. */
  sessionsDelete(p: { session_id: string }): Promise<void>;

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

  // ----- User-facing terminal (bottom panel) -----

  /** Spawn a new pty-backed shell. Returns the assigned terminalId,
   *  which the renderer then uses for all subsequent input/resize/
   *  dispose / data-subscription calls. cols/rows seed the initial
   *  pty window; cwd defaults to $HOME if omitted. */
  uiTermSpawn(p: { cwd?: string; cols: number; rows: number }): Promise<{ terminalId: string }>;
  /** Send keystrokes to the pty. `data` is the raw bytes xterm.js
   *  hands us via its `onData` callback (already encoded — we pass
   *  through). */
  uiTermInput(p: { terminalId: string; data: string }): Promise<void>;
  /** Window-size change. Send on container resize so curses-style
   *  programs reflow. */
  uiTermResize(p: { terminalId: string; cols: number; rows: number }): Promise<void>;
  /** Kill the pty + clean up listeners. Triggered when the tab closes. */
  uiTermDispose(p: { terminalId: string }): Promise<void>;
  /** Batched stdout/stderr chunks from a live pty. One push may carry
   *  many pty `onData` events coalesced inside a single ~16ms frame to
   *  keep IPC overhead in line with renderer throughput. */
  onUiTermData(
    handler: (frame: { terminalId: string; data: string }) => void,
  ): () => void;
  /** The pty exited (clean exit or signal). The renderer paints a
   *  small footer in the tab and stops listening on the channel. */
  onUiTermExit(
    handler: (frame: {
      terminalId: string;
      exitCode: number | null;
      signal: string | null;
    }) => void,
  ): () => void;

  // ----- User-facing fs (side-panel file tree) -----

  /** List the entries inside a directory. Folders first, then
   *  alphabetical. Returns an `error` field per entry when stat()
   *  failed (broken symlink, permission denied, etc.). Returns one
   *  synthetic error row when the directory itself can't be read. */
  uiFsListDir(p: { path: string }): Promise<
    { name: string; isDir: boolean; error?: string }[]
  >;

  /** $HOME (or %USERPROFILE% on Windows). Used by the file tree as a
   *  default root when no chat session has supplied a cwd yet. */
  uiFsHome(): Promise<string>;

  /** Open the native "Choose folder" dialog. Returns the picked
   *  absolute path, or null if the user cancelled. */
  uiFsPickDir(p?: { defaultPath?: string }): Promise<string | null>;

  /** Open the native file picker for prompt attachments. Returns an
   *  empty array when cancelled. Image entries include base64 `data`
   *  when small enough for preview / ACP image blocks. */
  uiFsPickFiles(p?: { defaultPath?: string }): Promise<PromptAttachment[]>;

  /** Recent entries in a directory — sorted by mtime (newest first),
   *  hidden / noise (.dotfiles, node_modules) filtered out. Top N
   *  returned. Used by the side-panel empty state "推荐" feed. */
  uiFsRecent(p: { path: string; limit?: number }): Promise<
    { name: string; path: string; isDir: boolean; mtime: number }[]
  >;

  /** Open a path with the OS-default handler. Returns "" on success
   *  or an error message string on failure. */
  uiFsOpenPath(p: { path: string }): Promise<string>;

  /** Read the current git branch for a workspace dir. Returns the
   *  branch name (e.g. "main"), or null if the path isn't a git repo,
   *  the read failed, or HEAD is detached (40-char SHA). */
  uiFsGitBranch(p: { path: string }): Promise<string | null>;

  /** Native menu fired a navigate request — payload is the route path. */
  onMenuNavigate(handler: (path: string) => void): () => void;
  /** Native menu fired a renderer action — payload is "new-chat" |
   *  "command-palette". */
  onMenuAction(handler: (action: string) => void): () => void;
}

declare global {
  interface Window {
    backchat: BackchatApi;
  }
}
