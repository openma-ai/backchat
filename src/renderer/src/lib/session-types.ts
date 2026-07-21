import type {
  AgentMessageDelivery,
  AgentMessageIntent,
} from "@shared/agent-interaction.js";
import type { AcpSessionConfigOption } from "./session-config-options";
import type { NativeAgentProvider } from "./native-agent-events";
import type { SubagentAvatarId } from "./subagent-avatar";

export interface SessionRow {
  id: string;
  agent_id: string;
  cwd: string;
  acp_session_id: string;
  /** UI label. Phase 3 derives from agent + short id; Phase 4 lets the user
   *  rename, persisting to SQLite. */
  label: string;
  /** Which surface owns this session.
   *    "main" → appears in the sidebar list, drives `/chat/$id`. Default.
   *    "side" → lives only in the side-chat rail. Filtered out of the
   *             sidebar `list()`. Its task workspace metadata is persisted
   *             separately so a restart restores the rail without promoting
   *             the child into the main session list.
   *    "pair" → ordinary persisted session that is grouped by a pair-chat
   *             UI row. Hidden from the single-chat sidebar because the
   *             pair row is the user-facing entry point.
   */
  kind?: "main" | "side" | "pair";
  /** Side-session subtype. Side chats are subordinate sessions attached
   *  to the active main session; native subagents are provider-created
   *  activity and are not user-created from the GUI. */
  sideKind?: "chat" | "subagent";
  /** Stable visual identity for a provider-native subagent session. */
  subagentAvatarId?: SubagentAvatarId;
  /** Parent link for GUI-created side chats. When the active ACP agent
   *  supports session/fork this seeds the side session from the parent
   *  ACP context; promoteSideToMain clears the link so the session
   *  becomes a normal independent fork. */
  sideParent?: SideSessionParentLink;
  /** Parent-child task metadata for side subagents. The optional ACP parent
   *  id is only used for fork-based context seeding; task progress is tracked
   *  in Backchat's own store. */
  subagent?: SubagentLink;
  /** Whether the live ACP agent advertised the unstable session/fork
   *  capability. This gates inherited subagent startup only. */
  supportsSessionFork?: boolean;
  /** Lifecycle:
   *    "draft"     → empty session, no IPC fired yet.
   *    "persisted" → loaded from disk; ACP child NOT spawned (spawns
   *                  lazily on first prompt with resume.acp_session_id).
   *    "starting"  → session.start IPC fired; awaiting session.ready.
   *    "ready"     → ACP child is alive, no in-flight turn.
   *    "running"   → a turn is streaming.
   *    "errored"   → start failed; lastError carries the reason.
   *    "disposed"  → main process killed the child.
   */
  status: "draft" | "persisted" | "starting" | "ready" | "running" | "errored" | "disposed";
  lastError?: string;
  createdAt: number;
  /** turn_id of the in-flight prompt, if any. */
  activeTurnId?: string;
  /** FIFO prompts submitted while `activeTurnId` is still running.
   *  The main process serializes them against the ACP session; the
   *  renderer keeps this list so completion of the current turn can
   *  promote the next optimistic turn from queued → running. */
  queuedTurnIds?: string[];
  /** Main-process prompt queue snapshot. This mirrors the runtime contract
   *  even when the current composer prevents normal users from double-send. */
  queuedPrompts?: Array<{ turn_id: string; text: string; created_at: number }>;
  /** User-picked workspace for a draft session. Only set when the user
   *  explicitly chose a directory via the composer's workspace chip;
   *  drafts without it use the main-process managed session cwd
   *  (userData/sessions/<sessionId>/).
   *
   *  Once the session leaves draft, the cwd is locked into `cwd` and
   *  this field is no longer consulted (the ACP child has already
   *  spawned with whatever path won). */
  chosenCwd?: string;
  /** Explicit ownership chosen at draft creation. This prevents a global
   *  New chat from inheriting the current/default project through ambient
   *  composer state. Project scope is only entered by a project `+` action
   *  or an explicit project selection in the composer. */
  projectScope?: "none" | "project";
  /** Slash commands the agent has declared via the ACP
   *  `available_commands_update` session event. Replaced wholesale on
   *  each update (agents emit the full list, not a delta). Empty array
   *  if the agent never sent one — composer then hides the slash
   *  picker entirely. */
  availableCommands?: AcpAvailableCommand[];
  /** Agent-declared ACP session configuration options from
   *  `session/new`, `session/load`, and `config_option_update`.
   *  These drive model / mode / thought-level controls in the run menu. */
  configOptions?: AcpSessionConfigOption[];
  /** Current mode id the agent has declared via `current_mode_update`.
   *  Kept as session state for composer controls and observability. */
  currentModeId?: string;
  /** Latest ACP context-window usage. Session-scoped and intentionally kept
   *  out of the transcript and title chrome. */
  usage?: AcpSessionUsage;
  /** Agent-owned session metadata from `session_info_update`. Local turn
   *  status remains authoritative so remote active/idle cannot leave the UI
   *  stuck in a running state after `session.complete`. */
  sessionUpdatedAt?: string;
  sessionInfoMeta?: Record<string, unknown>;
  agentThreadStatus?: string;
  /** Set when a turn completes (or errors) while this session is NOT
   *  the active one — gives the sidebar an "unread" affordance so the
   *  user can scan which background chats have new results. Cleared
   *  the moment setActive() points at this session.
   *
   *  Intentionally driven by turn completion (not every incoming chunk)
   *  so the dot doesn't flicker on for one chunk and off the next; it
   *  marks "there's something finished to look at". */
  unread?: boolean;
  /** Wall-clock ms the user pinned this session. Undefined when
   *  not pinned. Pinned sessions render in a separate "Pinned"
   *  section at the top of the sidebar. */
  pinnedAt?: number;
  /** Wall-clock ms when the user archived this session. Archived
   *  rows are hidden from the sidebar but kept in the persisted
   *  store so Search can find them and the user can unarchive. */
  archivedAt?: number;
  /** Pending permission asks waiting on a user decision. Pushed by the
   *  broker listener when an ACP child requests permission (or asks to
   *  write outside cwd). ChatView renders the head item as a floating
   *  panel above the composer; the user's click pops it and routes the
   *  decision back over IPC.
   *
   *  Per-session queue, FIFO. Agents rarely fire multiple before the
   *  first is answered, but the buffer keeps order intact when they do. */
  pendingAsks?: BrokerAsk[];
  /** Short-lived agent/adapter notice shown above the composer. These are
   *  operational messages, not assistant-authored transcript content. */
  notice?: SessionNotice;
}

export interface AcpSessionUsage {
  used: number;
  size: number;
  cost?: {
    amount: number;
    currency: string;
  };
}

export interface SessionNotice {
  id: string;
  message: string;
  tone: "warning";
  expiresAt: number;
}

export type BrokerAsk =
  | { kind: "permission"; ask: import("@shared/api.js").PermissionAskInfo }
  | { kind: "fsWrite"; ask: import("@shared/api.js").FsWriteAskInfo };

/** A pair-chat — fans a single user prompt out to N agents. Members
 *  are stored separately in `#sessions` (one SessionRow per member);
 *  this row holds pair-wide metadata only. */
export interface PairRow {
  id: string;
  /** Sidebar label, derived from the first prompt the same way single
   *  chats are. Empty until a prompt is sent. */
  label: string;
  /** Member session ids in column order. Indexes are stable across
   *  reload (the order is persisted via member created_at). */
  members: string[];
  /** Wall-clock of last activity — sidebar sort. */
  lastUsedAt: number;
  createdAt: number;
  /** A pair-wide active turn id locks all members' composers
   *  simultaneously: a new prompt only enables once every member has
   *  finished the current turn. Cleared when the LAST member completes. */
  activeTurnId?: string;
  /** Per-member normal session turn ids for the active pair prompt.
   *  The pair's UI has one prompt, but each underlying session gets a
   *  distinct turn id because the turn store is keyed by turn id. */
  memberTurnIds?: Record<string, string>;
  /** Set of member session ids still running the active turn. Empty
   *  set means turn complete. */
  pendingMembers?: Set<string>;
}

export type SubagentInheritance = "fresh" | "fork";

export interface SideSessionParentLink {
  parentSessionId: string;
  parentAcpSessionId?: string;
  inheritance: SubagentInheritance;
}

export interface SubagentLink {
  parentSessionId: string;
  parentAcpSessionId?: string;
  inheritance: SubagentInheritance;
}

export interface SubagentActivity {
  parentSessionId: string;
  parentAcpSessionId?: string;
  childSessionId: string;
  /** Stable renderer-owned session id used by the side-panel ChatView.
   *  Native providers may first report a fallback tool-call id and later
   *  replace it with the real child id; this id deliberately survives that
   *  migration so the tab and transcript never duplicate. */
  viewSessionId: string;
  avatarId: SubagentAvatarId;
  inheritance: SubagentInheritance;
  task: string;
  status: "draft" | "running" | "complete" | "error" | "cancelled";
  startedAt: number;
  updatedAt: number;
  errorMessage?: string;
  native?: NativeSubagentMetadata;
}

export interface NativeSubagentMetadata {
  provider: NativeAgentProvider;
  toolCallId?: string;
  childThreadId?: string;
  nickname?: string;
  agentType?: string;
  forkContext?: boolean;
  result?: string;
  closed?: boolean;
  childToolCallIds?: string[];
}

export interface PairTurnTarget {
  session_id: string;
  turn_id: string;
}

/** Mirrors ACP `AvailableCommand`. `input` describes what the command
 *  expects after the name — `unstructured` means a free-text argument
 *  (e.g. `/commit <message>`), no input means a bare command. */
export interface AcpAvailableCommand {
  name: string;
  description?: string;
  input?: { hint?: string } | null;
  /** Non-standard metadata some agents may attach. ACP v1 only
   *  defines name/description/input, but clients may receive extra
   *  fields and use them for display-only affordances. */
  kind?: string;
  type?: string;
  category?: string;
  source?: string;
  metadata?: Record<string, unknown>;
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
  /** Codex reasoning summaries are projected as one replaceable live status.
   * These fields track that tail without changing the persisted raw stream. */
  activeThoughtMessageId?: string;
  activeThoughtSegmentText?: string;
  status: "queued" | "running" | "complete" | "error" | "cancelled";
  promptIntent?: AgentMessageIntent;
  requestedDelivery?: AgentMessageDelivery;
  effectiveDelivery?: AgentMessageDelivery;
  deliveryDegraded?: boolean;
  errorMessage?: string;
  startedAt: number;
  endedAt?: number;
}

export interface TurnDeliveryMeta {
  intent: AgentMessageIntent;
  requestedDelivery: AgentMessageDelivery;
  effectiveDelivery: AgentMessageDelivery;
  degraded: boolean;
}

export type SideTabType = "chat" | "subagent" | "file" | "browser" | "terminal" | "process" | "interactive";

/** UI tab in the right rail. The `payload` field is type-specific — for
 *  chat it's a sessionId (matches SessionRow.id), for file it's a cwd
 *  path, for browser it's the current URL, for terminal it's a
 *  pty terminalId allocated by UiTermSpawn. */
export interface SideTab {
  id: string;
  type: SideTabType;
  /** Short label shown on the tab chip. Auto-derived per type:
   *    chat       → first prompt's deriveLabel
   *    file       → cwd's last segment
   *    browser    → page's hostname
   *    terminal   → cwd's last segment (matches BottomPanel) */
  label: string;
  payload: string;
  /** Original local artifact behind a browser-renderable preview. The
   *  browser payload may point at a generated PDF/image sidecar. */
  sourcePath?: string;
  /** Browser tabs populate this from Electron's page-favicon-updated event. */
  faviconUrl?: string;
  /** Provider-native subagents share this identity with their activity row. */
  avatarId?: SubagentAvatarId;
  /** Terminal process handles die with the app. Persist the cwd instead and
   *  spawn a fresh PTY when this task's restored rail becomes visible. */
  terminalCwd?: string;
  /** Renderer-only recovery flag. Never treated as a live terminal id. */
  needsRestore?: boolean;
  createdAt: number;
}

/** One task owns one logical browser window. Its webview tabs stay mounted
 *  independently from the right rail's currently selected surface, so
 *  switching to Files/Terminal (or another task) does not discard page state. */
export interface TaskBrowserWindow {
  taskId: string | null;
  tabs: SideTab[];
  activeTabId: string | null;
}

/** Things the agent has produced in a conversation — drives the side
 *  panel's "推荐" feed. Files and services kept as ordered, deduped
 *  arrays (newest at index 0). Capped at 50 each so a runaway turn
 *  can't bloat the store. */
export interface WorkspaceArtifacts {
  /** Absolute file paths the agent has read / written / edited. */
  files: string[];
  /** localhost / 127.0.0.1 URLs observed in tool output — the dev
   *  servers the agent has spun up. URL includes the port; same URL
   *  re-observed bubbles to the top, doesn't duplicate. */
  services: string[];
}

export interface SideSessionSnapshot {
  row: SessionRow;
  turns: Turn[];
}

export interface SideWorkspaceStateV1 {
  version: 1;
  tabs: SideTab[];
  activeTabId: string | null;
  activeBrowserTabId: string | null;
  artifacts: WorkspaceArtifacts;
  sideSessions: SideSessionSnapshot[];
  subagents: SubagentActivity[];
}

export interface TaskSideWorkspaceSnapshot {
  taskId: string;
  state: SideWorkspaceStateV1;
}
