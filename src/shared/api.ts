/**
 * Renderer-facing surface exposed via contextBridge. Renderer code reads this
 * type via `window.backchat`. Main owns the implementation; preload forwards.
 *
 * Keep narrow: every method is a permission boundary.
 */

import type {
  BrowserAssetBundleResult,
  BrowserAttachViewParams,
  BrowserClickParams,
  BrowserCuaClickParams,
  BrowserDevLogEntry,
  BrowserDevLogsParams,
  BrowserDialogAcceptParams,
  BrowserDialogInfo,
  BrowserDescriptor,
  BrowserDomCuaClickParams,
  BrowserEvaluateParams,
  BrowserGotoParams,
  BrowserLocatorAttributeParams,
  BrowserLocatorFillParams,
  BrowserLocatorParams,
  BrowserLocatorPressParams,
  BrowserLocatorSelectOptionParams,
  BrowserLocatorSetCheckedParams,
  BrowserNameSessionParams,
  BrowserPageAssetEntry,
  BrowserPressParams,
  BrowserPluginStateEvent,
  BrowserScreenshotParams,
  BrowserScreenshotResult,
  BrowserSetViewportParams,
  BrowserTabInfo,
  BrowserTabParams,
  BrowserTypeParams,
  BrowserVisibilityParams,
  BrowserWaitForLoadStateParams,
  BrowserWaitForURLParams,
} from "./browser-plugin.js";
import type {
  PromptAttachment,
  SessionEventOut,
  SessionPromptParams,
  SessionPromptQueueCommandParams,
  SessionRunCommandParams,
  SessionRestartMode,
  SessionRestartResult,
  SessionRuntimeStatus,
  SessionSetConfigOptionParams,
  SessionStartParams,
  SessionStartResult,
} from "./session-events.js";
import type { Settings } from "./settings.js";
import type {
  CreateScheduleInput,
  ScheduleInfo,
  ScheduleRunInfo,
  UpdateScheduleInput,
} from "./schedules.js";
import type {
  McpAppRequestInput,
  McpAppResolved,
  McpAppResolveInput,
} from "./mcp-app.js";
import type {
  BrowserElementHoverInfo,
  BrowserElementPickResult,
  BrowserRegionPickResult,
} from "./browser-element-picker.js";
import type {
  BrowserUiCommand,
  BrowserViewIdentityInput,
  BrowserViewRegistrationInput,
} from "./browser-harness.js";
import type {
  BrowserClearDataInput,
  BrowserClearProfileDataInput,
  BrowserCredentialSummary,
  BrowserDownloadInfo,
  BrowserWebContentsInput,
} from "./browser-data.js";
import type { ProjectInfo, ProjectSaveParams } from "./projects.js";
import type { OpenMAEvent } from "@openma/common/session-events/openma";

export interface AgentInfo {
  id: string;
  label: string;
  /** Official ACP registry icon URL, when available. */
  icon?: string;
  command: string;
  /** Human-readable. Set when the agent's binary isn't on PATH. */
  installHint?: string;
  homepage?: string;
  featured?: boolean;
  /** Whether the binary is actually on PATH right now. detectAll-derived. */
  detected: boolean;
  /** Alias for detected, kept explicit for setup UI copy. */
  available?: boolean;
  installed?: boolean;
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  installable?: boolean;
  installSource?: "registry" | "adapter";
  custom?: boolean;
  auth?: {
    status: "configured" | "needs-auth" | "unknown";
    message: string;
    methodId?: string;
    methodName?: string;
    methods?: Array<{
      id: string;
      name?: string;
      description?: string;
      type?: string;
      vars?: Array<{
        name: string;
        label?: string;
        secret?: boolean;
        optional?: boolean;
      }>;
      link?: string;
    }>;
  };
  config_options?: unknown[];
  available_commands?: unknown[];
  session_modes?: unknown;
  capability_inspection?: {
    status: "ready" | "blocked-auth" | "degraded";
    inspected_at: string;
    error?: string;
  };
}

export interface AgentListOptions {
  /** Explicit user refresh. Probe scope is owned by the setup service,
   * never supplied by renderer code. */
  refresh?: boolean;
  /** `snapshot` returns inventory plus persisted facts immediately. `ready`
   * waits for the cold-start barrier and is required for run selection. */
  readiness?: "snapshot" | "ready";
}

/** Public shape of a persisted session row. Mirrors PersistedSession in
 *  src/main/sql-store.ts. */
export interface PersistedSessionInfo {
  id: string;
  agent_id: string;
  cwd: string;
  acp_session_id: string;
  title: string;
  title_manually_set: number;
  last_used_at: number;
  created_at: number;
  archived_at: number | null;
  /** Wall-clock ms the user pinned this row, or null when not pinned.
   *  Older db files (pre-pin) have the column present but null. */
  pinned_at: number | null;
  project_id: string | null;
  /** Current project roots excluding this session's cwd. */
  additional_directories: string[];
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

/** Versioned renderer-owned workspace for one task's right sidebar.
 *  Main deliberately treats `state_json` as opaque: the renderer owns
 *  migration and validation while SQLite supplies durable task scoping. */
export interface PersistedSideWorkspaceInfo {
  task_id: string;
  state_json: string;
  updated_at: number;
}

export interface SideWorkspaceSaveParams {
  task_id: string;
  state_json: string;
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
  /** Opaque ACP ToolCallUpdate retained as callback evidence. GUI code must
   *  consume `presentation`, never inspect provider metadata here. */
  toolCall: unknown;
  /** Harness-neutral fields normalized at the main/per-harness boundary. */
  presentation: {
    title: string;
    kind?: string;
    reason?: string;
    command?: string;
  };
  options: Array<{
    optionId: string;
    name: string;
    /** ACP PermissionOptionKind — drives icon + button color. */
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
  }>;
}

export interface ElicitationFieldBase {
  name: string;
  title: string;
  description?: string;
  required: boolean;
}

export type ElicitationFieldInfo =
  | (ElicitationFieldBase & {
      type: "text";
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      format?: "email" | "uri" | "date" | "date-time";
      defaultValue?: string;
    })
  | (ElicitationFieldBase & {
      type: "number";
      integer: boolean;
      minimum?: number;
      maximum?: number;
      defaultValue?: number;
    })
  | (ElicitationFieldBase & {
      type: "boolean";
      defaultValue?: boolean;
    })
  | (ElicitationFieldBase & {
      type: "select";
      options: Array<{ value: string; label: string; description?: string }>;
      defaultValue?: string;
    })
  | (ElicitationFieldBase & {
      type: "multiselect";
      options: Array<{ value: string; label: string; description?: string }>;
      minItems?: number;
      maxItems?: number;
      defaultValue?: string[];
    });

export interface ElicitationFormRequestInfo {
  sessionId: string;
  message: string;
  fields: ElicitationFieldInfo[];
}

export type ElicitationFormResponseInfo =
  | {
      action: "accept";
      content: Record<string, string | number | boolean | string[]>;
    }
  | { action: "decline" | "cancel" };

export interface ElicitationUrlRequestInfo {
  sessionId: string;
  message: string;
  /** Opaque ACP identifier used only to correlate a later
   * `elicitation/complete` notification. */
  elicitationId: string;
  url: string;
}

export type ElicitationUrlResponseInfo =
  | { action: "accept" }
  | { action: "decline" | "cancel" };

export type ElicitationResponseInfo =
  | ElicitationFormResponseInfo
  | ElicitationUrlResponseInfo;

export type ElicitationFormAskInfo = ElicitationFormRequestInfo & {
  requestId: string;
  mode?: "form";
};

export type ElicitationUrlAskInfo = ElicitationUrlRequestInfo & {
  requestId: string;
  mode: "url";
};

export type ElicitationAskInfo = ElicitationFormAskInfo | ElicitationUrlAskInfo;

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

export type PendingBrokerAskInfo =
  | { kind: "permission"; ask: PermissionAskInfo }
  | { kind: "elicitation"; ask: ElicitationAskInfo }
  | { kind: "fsWrite"; ask: FsWriteAskInfo };

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
  terminationReason?: "user_kill" | "released" | "session_disposed";
}

/** Agent-owned command process created through ACP terminal/create. */
export interface AcpTerminalInfo {
  sessionId: string;
  terminalId: string;
  command: string;
  args: string[];
  cwd: string;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
  signal: string | null;
  /** Host-observed cancellation reason. Kept separate from the ACP exit
   *  status so the GUI can distinguish a user Stop from a command failure. */
  terminationReason?: "user_kill" | "released" | "session_disposed";
}

export interface AcpTerminalSnapshot extends AcpTerminalInfo {
  output: string;
  truncated: boolean;
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

export interface ActivityDayInfo {
  /** UTC calendar day. The renderer formats month labels in the user's locale. */
  date: string;
  /** New top-level tasks created that day; pair members count as one task. */
  tasks: number;
  /** User prompts persisted that day. */
  turns: number;
  /** Initial tool calls only; tool_call_update events are excluded. */
  tool_calls: number;
}

export interface HarnessActivityInfo {
  /** Persisted ACP agent id. In Backchat this is the harness dimension. */
  harness_id: string;
  /** Current display metadata from the ACP registry. */
  harness_label?: string;
  icon_url?: string;
  tasks: number;
  runs: number;
  turns: number;
  tool_calls: number;
  active_days: number;
  last_active_at: number;
}

export interface ActivityStatsInfo {
  summary: {
    total_tasks: number;
    total_runs: number;
    total_turns: number;
    total_tool_calls: number;
    total_harnesses: number;
    active_days: number;
    current_streak_days: number;
    longest_streak_days: number;
  };
  /** Oldest to newest, zero-filled to a fixed window. */
  daily: ActivityDayInfo[];
  /** Ordered by turns, then tool calls, descending. */
  harnesses: HarnessActivityInfo[];
}

export interface BackchatApi {
  /** Smoke test for the IPC channel. */
  ping(msg: string): Promise<string>;

  /** All known ACP agents merged from the official registry + overlay,
   *  flagged by detection. Renderer uses this to power the agent picker. */
  agentsList(options?: AgentListOptions): Promise<AgentInfo[]>;
  agentInstall(id: string): Promise<AgentInfo[]>;
  agentUpgrade(id: string): Promise<AgentInfo[]>;
  agentUninstall(id: string): Promise<AgentInfo[]>;
  agentAuthenticate(p: { id: string; methodId?: string }): Promise<AgentInfo[]>;

  sessionStart(p: SessionStartParams): Promise<SessionStartResult>;
  sessionPrompt(p: SessionPromptParams): Promise<void>;
  sessionUpdatePromptQueue(p: SessionPromptQueueCommandParams): Promise<void>;
  sessionRunCommand(p: SessionRunCommandParams): Promise<void>;
  sessionSetConfigOption(p: SessionSetConfigOptionParams): Promise<void>;
  sessionCancel(p: { session_id: string; turn_id: string }): Promise<void>;
  sessionDispose(p: { session_id: string; remove_cwd?: boolean }): Promise<void>;
  sessionRuntimeStatus(p: {
    session_id: string;
  }): Promise<SessionRuntimeStatus | null>;
  sessionRestart(p: {
    session_id: string;
    mode: SessionRestartMode;
  }): Promise<SessionRestartResult>;

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
  pairsPin(p: { pair_id: string }): Promise<void>;
  pairsUnpin(p: { pair_id: string }): Promise<void>;
  pairsArchive(p: { pair_id: string }): Promise<void>;
  pairsUnarchive(p: { pair_id: string }): Promise<void>;

  projectsList(): Promise<ProjectInfo[]>;
  projectSave(p: ProjectSaveParams): Promise<ProjectInfo>;
  projectDelete(p: { project_id: string }): Promise<void>;

  /** List persisted sessions (most-recent first, archived hidden). Used by
   *  the renderer on boot to rebuild the sidebar from disk before any
   *  live session.ready arrives. */
  sessionsList(limit?: number): Promise<PersistedSessionInfo[]>;
  sessionsRename(p: { session_id: string; title: string }): Promise<void>;

  /** Replay the event log for a persisted session, in seq order. Renderer
   *  feeds these back into its in-memory store to reconstruct turns. */
  sessionsLoadHistory(sessionId: string): Promise<PersistedEventInfo[]>;

  /** Persist a canonical event synthesized by a renderer-side adapter. Main
   * remains the SQL owner; this is used for native Agent/Task observations
   * derived after the ACP payload reaches the store. */
  sessionPersistCanonicalEvent(event: OpenMAEvent): Promise<void>;

  /** Durable right-rail UI/workspace state, one opaque JSON document per task. */
  sideWorkspacesList(): Promise<PersistedSideWorkspaceInfo[]>;
  sideWorkspaceSave(p: SideWorkspaceSaveParams): Promise<void>;
  sideWorkspaceDelete(p: { task_id: string }): Promise<void>;

  /** Full-text search across persisted chat prose. Used by Cmd+K's
   *  Search section. Empty query returns []. */
  sessionsSearch(query: string, limit?: number): Promise<SearchHitInfo[]>;
  /** Local-only activity analytics derived from the session SQLite index. */
  activityStats(): Promise<ActivityStatsInfo>;

  /** Local background task schedules shared by every ACP harness. */
  schedulesList(): Promise<ScheduleInfo[]>;
  schedulesCreate(p: CreateScheduleInput): Promise<ScheduleInfo>;
  schedulesUpdate(p: UpdateScheduleInput): Promise<ScheduleInfo>;
  schedulesDelete(p: { id: string }): Promise<void>;
  scheduleRunsList(p: { schedule_id: string }): Promise<ScheduleRunInfo[]>;

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
   *  the on-disk session dir under `~/.oma/sessions/<id>/`. Caller
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

  /** Resolve and proxy the official io.modelcontextprotocol/ui extension.
   *  The main process owns MCP transports; untrusted Views never receive
   *  server credentials or direct access to Node/Electron APIs. */
  mcpAppResolve(p: McpAppResolveInput): Promise<McpAppResolved | null>;
  mcpAppRequest(p: McpAppRequestInput): Promise<unknown>;
  /** Read a visualization fragment scoped to the active task workspace. */
  inlineVisualizationRead(p: {
    cwd: string;
    file: string;
  }): Promise<{ file: string; content: string }>;
  inlineVisualizationRegisterDocument(p: { html: string }): Promise<{ document_url: string }>;
  inlineVisualizationWatch(p: { cwd: string; file: string }): Promise<{ watch_id: string }>;
  inlineVisualizationUnwatch(p: { watch_id: string }): Promise<void>;
  onInlineVisualizationChanged(handler: (event: { watch_id: string }) => void): () => void;

  // ----- Brokers (Phase 6) -----

  /** Subscribe to permission asks pushed from the main process. Modal
   *  decides; call `permissionRespond` with the chosen optionId (or null
   *  for cancel). */
  onPermissionRequest(handler: (ask: PermissionAskInfo) => void): () => void;
  permissionRespond(requestId: string, optionId: string | null): Promise<void>;
  onElicitationRequest(handler: (ask: ElicitationAskInfo) => void): () => void;
  elicitationRespond(
    requestId: string,
    response: ElicitationResponseInfo,
  ): Promise<void>;
  /** Snapshot of unresolved broker asks. Used after renderer reload so a
   *  blocking approval cannot be lost between IPC subscription lifetimes. */
  brokerPendingAsks(): Promise<PendingBrokerAskInfo[]>;

  /** Out-of-cwd write approval flow. */
  onFsWriteApproval(handler: (ask: FsWriteAskInfo) => void): () => void;
  fsApprovalRespond(requestId: string, approved: boolean): Promise<void>;

  /** Per-terminal live output. */
  onTerminalOutput(handler: (frame: TerminalOutputFrame) => void): () => void;
  onTerminalExit(handler: (frame: TerminalExitFrame) => void): () => void;
  acpTerminalsList(p: { sessionId: string }): Promise<AcpTerminalInfo[]>;
  acpTerminalSnapshot(p: { terminalId: string }): Promise<AcpTerminalSnapshot | null>;
  acpTerminalKill(p: { terminalId: string }): Promise<void>;

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

  // ----- In-app browser annotations -----

  browserElementPickerBegin(p: { webContentsId: number }): Promise<void>;
  browserElementPickerHover(p: {
    webContentsId: number;
    x: number;
    y: number;
  }): Promise<BrowserElementHoverInfo | null>;
  browserElementPickerCommit(p: {
    webContentsId: number;
  }): Promise<BrowserElementPickResult | null>;
  browserElementPickerCaptureRegion(p: {
    webContentsId: number;
    rect: { x: number; y: number; width: number; height: number };
  }): Promise<BrowserRegionPickResult>;
  browserElementPickerCancel(p: { webContentsId: number }): Promise<void>;
  browserViewRegister(p: BrowserViewRegistrationInput): Promise<void>;
  browserViewUnregister(p: BrowserViewIdentityInput): Promise<void>;
  browserViewSetActive(p: BrowserViewIdentityInput): Promise<void>;
  browserCaptureScreenshot(p: BrowserWebContentsInput): Promise<{ path: string }>;
  browserShowDeviceToolbar(p: BrowserWebContentsInput): Promise<void>;
  browserClearData(p: BrowserClearDataInput): Promise<void>;
  browserClearProfileData(p: BrowserClearProfileDataInput): Promise<void>;
  browserDownloadsList(p: BrowserWebContentsInput): Promise<BrowserDownloadInfo[]>;
  browserDownloadAction(p: BrowserWebContentsInput & {
    downloadId: string;
    action: "open" | "reveal" | "cancel";
  }): Promise<void>;
  browserCredentialsList(p: BrowserWebContentsInput): Promise<BrowserCredentialSummary[]>;
  browserCredentialFill(p: BrowserWebContentsInput & { credentialId: string }): Promise<void>;
  browserCredentialDelete(p: BrowserWebContentsInput & { credentialId: string }): Promise<void>;
  onBrowserDownloadsChanged(handler: () => void): () => void;
  onBrowserToolTabCommand(handler: (command: BrowserUiCommand) => void): () => void;

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
  /** Open a native multi-directory picker. */
  uiFsPickDirs(p?: { defaultPath?: string }): Promise<string[]>;

  /** Open the native file picker for prompt attachments. Returns an
   *  empty array when cancelled. Image entries include base64 `data`
   *  when small enough for preview / ACP image blocks. */
  uiFsPickFiles(p?: { defaultPath?: string }): Promise<PromptAttachment[]>;

  /** Search files below a workspace root for composer @-mentions. */
  uiFsSearchFiles(p: { path: string; query?: string; limit?: number }): Promise<PromptAttachment[]>;

  /** Persist an in-app PNG capture under the local Backchat data root and
   *  return a fully populated image attachment, including inline base64. */
  uiFsSaveCapture(p: {
    data: string;
    name?: string;
    mimeType?: "image/png";
  }): Promise<PromptAttachment>;

  /** Recent entries in a directory — sorted by mtime (newest first),
   *  hidden / noise (.dotfiles, node_modules) filtered out. Top N
   *  returned. Used by the side-panel empty state "推荐" feed. */
  uiFsRecent(p: { path: string; limit?: number }): Promise<
    { name: string; path: string; isDir: boolean; mtime: number }[]
  >;

  /** Open a path with the OS-default handler. Returns "" on success
   *  or an error message string on failure. */
  uiFsOpenPath(p: { path: string }): Promise<string>;

  /** Reveal a path in Finder / Explorer. */
  uiFsRevealPath(p: { path: string }): Promise<void>;

  /** Return a browser-renderable local preview when one is available. */
  uiFsResolvePreview(p: { path: string }): Promise<{
    sourcePath: string;
    previewPath: string;
    kind: "document" | "image" | "web" | "text";
  } | null>;

  /** Read the current git branch for a workspace dir. Returns the
   *  branch name (e.g. "main"), or null if the path isn't a git repo,
   *  the read failed, or HEAD is detached (40-char SHA). */
  uiFsGitBranch(p: { path: string }): Promise<string | null>;

  // ----- Browser plugin bridge -----

  browserList(): Promise<BrowserDescriptor[]>;
  browserGet(p: { browser: string }): Promise<BrowserDescriptor>;
  browserTabs(p: { browser: string }): Promise<BrowserTabInfo[]>;
  browserGetTab(p: BrowserTabParams): Promise<BrowserTabInfo>;
  browserSelectedTab(p: { browser: string }): Promise<BrowserTabInfo | null>;
  browserUserOpenTabs(p: { browser: string }): Promise<BrowserTabInfo[]>;
  browserSelectTab(p: BrowserTabParams): Promise<BrowserTabInfo>;
  browserNameSession(p: BrowserNameSessionParams): Promise<{ browser: string; name: string }>;
  browserSessionName(p: { browser: string }): Promise<string | null>;
  browserNewTab(p: { browser: string }): Promise<BrowserTabInfo>;
  browserGoto(p: BrowserGotoParams): Promise<BrowserTabInfo>;
  browserSetVisibility(p: BrowserVisibilityParams): Promise<void>;
  browserGetVisibility(p: { browser: string }): Promise<boolean>;
  browserSetViewport(p: BrowserSetViewportParams): Promise<void>;
  browserResetViewport(p: { browser: string }): Promise<void>;
  browserAttachView(p: BrowserAttachViewParams): Promise<void>;
  browserDetachView(p: BrowserTabParams): Promise<void>;
  browserReload(p: BrowserTabParams): Promise<BrowserTabInfo>;
  browserBack(p: BrowserTabParams): Promise<BrowserTabInfo>;
  browserForward(p: BrowserTabParams): Promise<BrowserTabInfo>;
  browserWaitForURL(p: BrowserWaitForURLParams): Promise<BrowserTabInfo>;
  browserWaitForLoadState(p: BrowserWaitForLoadStateParams): Promise<BrowserTabInfo>;
  browserTitle(p: BrowserTabParams): Promise<string | null>;
  browserUrl(p: BrowserTabParams): Promise<string | null>;
  browserCloseTab(p: BrowserTabParams): Promise<void>;
  browserScreenshot(p: BrowserScreenshotParams): Promise<BrowserScreenshotResult>;
  browserPageAssets(p: BrowserTabParams): Promise<BrowserPageAssetEntry[]>;
  browserBundleAssets(p: BrowserTabParams): Promise<BrowserAssetBundleResult>;
  browserDomSnapshot(p: BrowserTabParams): Promise<string>;
  browserEvaluate(p: BrowserEvaluateParams): Promise<unknown>;
  browserClick(p: BrowserClickParams): Promise<void>;
  browserType(p: BrowserTypeParams): Promise<void>;
  browserPress(p: BrowserPressParams): Promise<void>;
  browserCuaClick(p: BrowserCuaClickParams): Promise<void>;
  browserDomCuaSnapshot(p: BrowserTabParams): Promise<string>;
  browserDomCuaClick(p: BrowserDomCuaClickParams): Promise<void>;
  browserLocatorCount(p: BrowserLocatorParams): Promise<number>;
  browserLocatorClick(p: BrowserLocatorParams): Promise<void>;
  browserLocatorFill(p: BrowserLocatorFillParams): Promise<void>;
  browserLocatorPress(p: BrowserLocatorPressParams): Promise<void>;
  browserLocatorSetChecked(p: BrowserLocatorSetCheckedParams): Promise<void>;
  browserLocatorSelectOption(p: BrowserLocatorSelectOptionParams): Promise<void>;
  browserLocatorInnerText(p: BrowserLocatorParams): Promise<string>;
  browserLocatorAttribute(p: BrowserLocatorAttributeParams): Promise<string | null>;
  browserDialog(p: BrowserTabParams): Promise<BrowserDialogInfo | null>;
  browserAcceptDialog(p: BrowserDialogAcceptParams): Promise<void>;
  browserDismissDialog(p: BrowserTabParams): Promise<void>;
  browserClipboardReadText(): Promise<string>;
  browserClipboardWriteText(p: { text: string }): Promise<void>;
  browserDevLogs(p: BrowserDevLogsParams): Promise<BrowserDevLogEntry[]>;
  onBrowserPluginState(handler: (event: BrowserPluginStateEvent) => void): () => void;

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
