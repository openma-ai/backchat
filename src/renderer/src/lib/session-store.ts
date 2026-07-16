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
import type {
  AgentMessageDelivery,
  AgentMessageIntent,
} from "@shared/agent-interaction.js";
import { setRightRailCollapsed } from "@/lib/right-rail";
import {
  selectedModeIdFromConfigOptions,
  type AcpSessionConfigOption,
} from "./session-config-options";
import {
  mergeStreamingText,
  parseAcpEvent,
  sessionUpdateInner,
  sessionUpdateType,
} from "./reduce-turn";
import {
  detectNativeAgentRawEvent,
  detectNativeAgentToolEvent,
  type NativeAgentContext,
  type NativeAgentProvider,
  type NativeAgentUpdate,
} from "./native-agent-events";

export type { AcpSessionConfigOption } from "./session-config-options";

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
   *             sidebar `list()`. Not persisted to SQLite (renderer-only
   *             scratch session — quitting and reopening loses it, matching
   *             Codex's side-conversation lifetime).
   *    "pair" → ordinary persisted session that is grouped by a pair-chat
   *             UI row. Hidden from the single-chat sidebar because the
   *             pair row is the user-facing entry point.
   */
  kind?: "main" | "side" | "pair";
  /** Side-session subtype. Side chats are subordinate sessions attached
   *  to the active main session; native subagents are provider-created
   *  activity and are not user-created from the GUI. */
  sideKind?: "chat" | "subagent";
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
   *  drafts without it fall back to settings.default.workspace_path on
   *  submit, or — if that's also empty — the main-process managed
   *  session cwd (userData/sessions/<sessionId>/).
   *
   *  Once the session leaves draft, the cwd is locked into `cwd` and
   *  this field is no longer consulted (the ACP child has already
   *  spawned with whatever path won). */
  chosenCwd?: string;
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
   *  Surfaced in the topbar next to the agent label. The agent owns
   *  the available mode set; we just echo whatever it said. */
  currentModeId?: string;
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

export type SideTabType = "chat" | "subagent" | "file" | "browser" | "terminal";

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
  /** Browser tabs populate this from Electron's page-favicon-updated event. */
  faviconUrl?: string;
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

export class SessionStore {
  #sessions = new Map<string, SessionRow>();
  #turns = new Map<string, Turn>();
  /** Pair-chats. Each pair owns N member session ids; the members
   *  themselves live in `#sessions` like any other session — the pair
   *  is just metadata. Routing is by id: navigating to /pair/<id>
   *  renders PairChatView which reads the pair row + each member. */
  #pairs = new Map<string, PairRow>();
  #activeId: string | null = null;
  /** Independent active pointer for the side-chat rail. Two surfaces
   *  share one record set but each renders its own active session via
   *  a dedicated selector. `null` when the user hasn't started a side
   *  conversation in this window yet. */
  #sideActiveId: string | null = null;
  /** Side panel tab list — keyed by main session id. Each entry is a
   *  UI tab in the right rail; type drives which component renders
   *  inside. `null` key = the home route (no active main session),
   *  which gets its own sandbox so users can poke around before
   *  picking a chat.
   *
   *  Tabs are tied to the main session — switching to another main
   *  session swaps the entire rail content (Codex behavior). Pty
   *  children + ACP children + browser webview live on `terminalId` /
   *  `sessionId` IDs in main process so they survive the visual swap
   *  even though their xterm.js / ChatView / <webview> hosts unmount
   *  when the rail switches. */
  #sideTabsByMain = new Map<string | null, SideTab[]>();
  #activeSideTabByMain = new Map<string | null, string | null>();
  #activeBrowserTabByMain = new Map<string | null, string>();
  /** Collected workspace artifacts per main session. Updated lazily
   *  from the session.event stream: file paths from tool_call rawInput,
   *  localhost URLs from tool_call rawOutput. Used by the side panel's
   *  EmptyState 推荐 feed to surface what the agent has actually
   *  touched in this conversation. Stored as ordered arrays so a tail
   *  read shows the most recent items first. */
  #artifactsBySession = new Map<string, WorkspaceArtifacts>();
  /** Per-session set of html paths we've already auto-opened in the
   *  side BrowserTab. Without this, every `tool_call_update` reflow
   *  during a stream would re-open the same tab. Cleared on session
   *  dispose. */
  #autoOpenedHtmlBySession = new Map<string, Set<string>>();
  /** Parent session id → child task activity. This is Backchat's subagent
   *  communication surface: fork only seeds context, while this map tracks
   *  task assignment, progress, completion and errors. */
  #subagentsByParent = new Map<string, SubagentActivity[]>();
  #nativeAgentContextByToolCall = new Map<
    string,
    NativeAgentContext & { parentSessionId: string }
  >();
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

  /** Keep only one event per uninterrupted text/thought run. ACP adapters
   *  commonly emit one event per token; retaining each token makes both the
   *  event array and reduceTurn work grow without adding timeline detail.
   *  Tool/plan events still break runs because they remain between segments. */
  #appendStreamEvent(
    turn: Turn,
    kind: "text" | "thought",
    text: string,
    receivedAt: number,
  ): void {
    const last = turn.events.at(-1);
    const parsedLast = last ? parseAcpEvent(last.payload) : null;
    if (parsedLast?.kind === kind) {
      const merged = mergeStreamingText(parsedLast.text, text);
      turn.events[turn.events.length - 1] = {
        payload: {
          sessionUpdate:
            kind === "text" ? "agent_message_chunk" : "agent_thought_chunk",
          content: { type: "text", text: merged },
        },
        receivedAt: last!.receivedAt,
      };
      return;
    }
    turn.events.push({
      payload: {
        sessionUpdate:
          kind === "text" ? "agent_message_chunk" : "agent_thought_chunk",
        content: { type: "text", text },
      },
      receivedAt,
    });
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
    let value = selector(this);
    // list()/turnsFor()/pairList() intentionally return derived arrays. A
    // global store version bump may be unrelated to that collection; retain
    // the previous array when all members are still identical so
    // useSyncExternalStore can skip the component render.
    if (
      cached &&
      Array.isArray(cached.value) &&
      Array.isArray(value) &&
      cached.value.length === value.length &&
      cached.value.every((item, index) =>
        Object.is(item, (value as readonly unknown[])[index]),
      )
    ) {
      value = cached.value as T;
    }
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
    // Drafts are excluded from the sidebar — a draft is "the user is
    // currently composing on the home route". It promotes into a real
    // sidebar row the moment the first prompt is submitted (see
    // promoteDraft, which derives a label from the prompt text).
    //
    // Side-chat sessions (kind === "side") never enter the sidebar —
    // they live in the right rail and are intentionally ephemeral.
    //
    // Pair members (kind === "pair") are normal persisted sessions,
    // but the pair UI row is the sidebar entry point; listing each
    // member as a separate chat would duplicate the conversation.
    //
    // Archived sessions (archivedAt set) are also filtered out — the
    // sidebar shows only "active" chats. The row still lives in the
    // Map and is reachable via Search, unarchive, or when the
    // session is reused (e.g. a fresh turn creates a row that
    // resurrects the same id).
    return [...this.#sessions.values()]
      .filter(
        (s) =>
          s.status !== "draft" &&
          s.kind !== "side" &&
          s.kind !== "pair" &&
          s.archivedAt == null,
      )
      .sort((a, b) => b.createdAt - a.createdAt);
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

  sideActiveId(): string | null {
    return this.#sideActiveId;
  }

  sideActive(): SessionRow | null {
    return this.#sideActiveId
      ? (this.#sessions.get(this.#sideActiveId) ?? null)
      : null;
  }

  turnsFor(sessionId: string): Turn[] {
    return [...this.#turns.values()]
      .filter((t) => t.sessionId === sessionId)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  subagentsFor(parentSessionId: string): SubagentActivity[] {
    return [...(this.#subagentsByParent.get(parentSessionId) ?? [])].sort(
      (a, b) => a.startedAt - b.startedAt,
    );
  }

  subagentByChildId(childSessionId: string): SubagentActivity | null {
    for (const list of this.#subagentsByParent.values()) {
      const match = list.find((activity) => activity.childSessionId === childSessionId);
      if (match) return match;
    }
    return null;
  }

  // ------- Mutations called by the UI -------

  setActive(id: string | null): void {
    if (this.#activeId === id) return;
    this.#activeId = id;
    // Clear unread on the row we're focusing — the user is now looking
    // at it, so the "there's something new here" dot has served its
    // purpose and shouldn't linger.
    if (id) {
      const row = this.#sessions.get(id);
      if (row?.unread) {
        this.#mutateSession(id, (s) => ({ ...s, unread: false }));
      }
    }
    // Side tabs live in a Map keyed by main session id. After the
    // switch, resync #sideActiveId so the now-active bucket's
    // session-backed tab (if any) is the side ChatView subscribes to.
    const newBucketActiveTabId = this.#activeSideTabByMain.get(id) ?? null;
    if (newBucketActiveTabId) {
      const tab = (this.#sideTabsByMain.get(id) ?? []).find(
        (t) => t.id === newBucketActiveTabId,
      );
      this.#sideActiveId = tab && isSideSessionTab(tab.type) ? tab.payload : null;
    } else {
      this.#sideActiveId = null;
    }
    this.#emit();
  }

  setSideActive(id: string | null): void {
    if (this.#sideActiveId === id) return;
    this.#sideActiveId = id;
    this.#emit();
  }

  /** Set or clear the user-picked workspace for a draft session. No-op
   *  on non-draft rows (their cwd is already locked into the ACP child).
   *  Pass null to revert to the auto-managed fallback. */
  setChosenCwd(id: string, cwd: string | null): void {
    const row = this.#sessions.get(id);
    if (!row || row.status !== "draft") return;
    this.#mutateSession(id, (s) => ({
      ...s,
      chosenCwd: cwd ?? undefined,
    }));
    this.#emit();
  }

  /** Push a new broker ask onto a session's pending queue. The session
   *  may not exist yet (race with session.ready); in that case we drop
   *  the ask silently — the IPC source already routes by session_id,
   *  so a dropped ask means the agent's host record vanished, which
   *  is best surfaced by main's cleanup paths, not the UI. */
  enqueueAsk(sessionId: string, ask: BrokerAsk): void {
    const row = this.#sessions.get(sessionId);
    if (!row) return;
    this.#mutateSession(sessionId, (s) => ({
      ...s,
      pendingAsks: [...(s.pendingAsks ?? []), ask],
    }));
    this.#emit();
  }

  /** Remove an ask by its request id — called after the user picks an
   *  option (or the ask gets superseded by a cancel). */
  dequeueAsk(sessionId: string, requestId: string): void {
    const row = this.#sessions.get(sessionId);
    if (!row?.pendingAsks?.length) return;
    const next = row.pendingAsks.filter((a) => a.ask.requestId !== requestId);
    this.#mutateSession(sessionId, (s) => ({
      ...s,
      pendingAsks: next.length ? next : undefined,
    }));
    this.#emit();
  }

  // -------- Pin / archive --------

  /** Mark a session as pinned with the current wall-clock. The
   *  sidebar splits Pinned + Chats sections; this row moves to
   *  Pinned immediately. Pinned_at is also written through to the
   *  SQLite row (fire-and-forget) so the position survives a reload. */
  pin(sessionId: string): void {
    const row = this.#sessions.get(sessionId);
    if (!row) return;
    const at = Date.now();
    this.#mutateSession(sessionId, (s) => ({ ...s, pinnedAt: at }));
    void window.backchat.sessionsPin({ session_id: sessionId });
    this.#emit();
  }

  unpin(sessionId: string): void {
    const row = this.#sessions.get(sessionId);
    if (!row) return;
    this.#mutateSession(sessionId, (s) => ({ ...s, pinnedAt: undefined }));
    void window.backchat.sessionsUnpin({ session_id: sessionId });
    this.#emit();
  }

  /** Hide a session from the sidebar. Row + events stay in the
   *  in-memory map and on disk so Search can find it and the user
   *  can unarchive later. */
  archive(sessionId: string): void {
    const row = this.#sessions.get(sessionId);
    if (!row) return;
    const at = Date.now();
    this.#mutateSession(sessionId, (s) => ({ ...s, archivedAt: at }));
    void window.backchat.sessionsArchive({ session_id: sessionId });
    this.#emit();
  }

  unarchive(sessionId: string): void {
    const row = this.#sessions.get(sessionId);
    if (row) {
      // Row is still in the in-memory map (e.g. just archived this
      // session) — clear the archivedAt flag in place. Sidebar's
      // filter will let it surface again.
      this.#mutateSession(sessionId, (s) => ({ ...s, archivedAt: undefined }));
    }
    // Otherwise the archived row was loaded only via
    // `listArchivedPersisted` and isn't tracked locally. The IPC
    // call updates SQL; the caller (Archive page) is expected to
    // re-fetch its list and the next sidebar `seedPersisted` /
    // session.start will surface the row when needed.
    void window.backchat.sessionsUnarchive({ session_id: sessionId });
    this.#emit();
  }

  /** Permanently delete a session — drops the SQL row + the on-disk
   *  session dir via IPC, and wipes any local in-memory state so the
   *  UI doesn't keep a ghost row around. Caller is responsible for
   *  the confirm prompt; this method assumes the user has already
   *  said yes. Async because the main-side rm waits on disk I/O. */
  async deletePermanently(sessionId: string): Promise<void> {
    await window.backchat.sessionsDelete({ session_id: sessionId });
    // Pop in-memory bookkeeping. Same shape as session.disposed
    // teardown so any subscriber sees a clean removal.
    if (this.#activeId === sessionId) this.#activeId = null;
    if (this.#sideActiveId === sessionId) this.#sideActiveId = null;
    this.#sessions.delete(sessionId);
    this.#autoOpenedHtmlBySession.delete(sessionId);
    this.#artifactsBySession.delete(sessionId);
    for (const [tid, turn] of this.#turns) {
      if (turn.sessionId === sessionId) this.#turns.delete(tid);
    }
    this.#emit();
  }

  /** Fetch the archived-session list from SQL on demand. Not cached
   *  here — the archive page only renders when the user explicitly
   *  navigates to it, and the list is small. */
  async listArchivedPersisted(): Promise<import("@shared/api.js").PersistedSessionInfo[]> {
    return window.backchat.sessionsListArchived();
  }

  // -------- Side tabs (multi-tab right rail, per-main-session) --------

  /** Active main session id used as the side-tab bucket key. `null`
   *  when the user is on home / no chat selected. Anything that
   *  reads or writes side-tab state routes through this. */
  #sideBucket(): string | null {
    return this.#activeId;
  }

  #tabsBucket(): SideTab[] {
    return this.#sideTabsByMain.get(this.#sideBucket()) ?? [];
  }

  #setTabsBucket(next: SideTab[]): void {
    const key = this.#sideBucket();
    if (next.length === 0) this.#sideTabsByMain.delete(key);
    else this.#sideTabsByMain.set(key, next);
  }

  #activeBucket(): string | null {
    return this.#activeSideTabByMain.get(this.#sideBucket()) ?? null;
  }

  #setActiveBucket(next: string | null): void {
    const key = this.#sideBucket();
    if (next == null) this.#activeSideTabByMain.delete(key);
    else this.#activeSideTabByMain.set(key, next);
  }

  sideTabs(): SideTab[] {
    return this.#tabsBucket();
  }

  activeSideTabId(): string | null {
    return this.#activeBucket();
  }

  activeSideTab(): SideTab | null {
    const id = this.#activeBucket();
    if (!id) return null;
    return this.#tabsBucket().find((t) => t.id === id) ?? null;
  }

  browserWindows(): TaskBrowserWindow[] {
    const windows: TaskBrowserWindow[] = [];
    for (const [taskId, sideTabs] of this.#sideTabsByMain) {
      const tabs = sideTabs.filter((tab) => tab.type === "browser");
      if (tabs.length === 0) continue;
      const remembered = this.#activeBrowserTabByMain.get(taskId);
      const activeTabId = tabs.some((tab) => tab.id === remembered)
        ? remembered!
        : tabs[0]!.id;
      windows.push({ taskId, tabs, activeTabId });
    }
    return windows;
  }

  /** Add a tab to the side rail. For chat/subagent tabs the caller should
   *  pre-create the SessionRow and pass the new id as `payload`. For
   *  non-session tabs, payload is the type-specific scratch state.
   *  Returns the new tab's id. */
  #openSideTabForBucket(
    bucket: string | null,
    type: SideTabType,
    payload: string,
    label?: string,
    requestedId?: string,
  ): string {
    const id = requestedId || `tab-${Math.random().toString(36).slice(2, 8)}`;
    const prevTabs = this.#sideTabsByMain.get(bucket) ?? [];
    const existingIndex = prevTabs.findIndex((tab) => tab.id === id);
    if (existingIndex >= 0) {
      const existing = prevTabs[existingIndex]!;
      const next: SideTab = {
        ...existing,
        type,
        payload,
        label: label || defaultSideTabLabel(type, payload),
      };
      this.#sideTabsByMain.set(bucket, [
        ...prevTabs.slice(0, existingIndex),
        next,
        ...prevTabs.slice(existingIndex + 1),
      ]);
      this.#activeSideTabByMain.set(bucket, id);
      if (type === "browser") this.#activeBrowserTabByMain.set(bucket, id);
      this.#syncVisibleSideSession(bucket);
      setRightRailCollapsed(false);
      this.#emit();
      return id;
    }
    const tab: SideTab = {
      id,
      type,
      label: label || defaultSideTabLabel(type, payload),
      payload,
      createdAt: Date.now(),
    };
    this.#sideTabsByMain.set(bucket, [...prevTabs, tab]);
    this.#activeSideTabByMain.set(bucket, id);
    if (type === "browser") this.#activeBrowserTabByMain.set(bucket, id);
    // Spawning a tab that the user can't see is pointless — ensure
    // the right rail is expanded. setRightRailCollapsed(false) is a
    // no-op when already open AND when the provider hasn't mounted
    // yet, so it's safe to call unconditionally here.
    setRightRailCollapsed(false);
    // Session-backed tabs need the SessionRow's side-active pointer to match so
    // existing ChatView(mode="side") plumbing still resolves the row.
    this.#syncVisibleSideSession(bucket);
    this.#emit();
    return id;
  }

  openSideTab(type: SideTabType, payload: string, label?: string): string {
    return this.#openSideTabForBucket(this.#sideBucket(), type, payload, label);
  }

  openSideTabForTask(
    taskId: string,
    type: SideTabType,
    payload: string,
    label?: string,
    tabId?: string,
  ): string {
    return this.#openSideTabForBucket(taskId, type, payload, label, tabId);
  }

  /** Update a tab's mutable fields (label rename, URL change for a
   *  browser tab, cwd navigate for a file tab). The tab object is
   *  replaced immutably so React identity comparisons see the change. */
  patchSideTab(id: string, patch: Partial<Omit<SideTab, "id" | "createdAt">>): void {
    this.#patchSideTabForBucket(this.#sideBucket(), id, patch);
  }

  patchSideTabForTask(
    taskId: string | null,
    id: string,
    patch: Partial<Omit<SideTab, "id" | "createdAt">>,
  ): void {
    this.#patchSideTabForBucket(taskId, id, patch);
  }

  #patchSideTabForBucket(
    bucket: string | null,
    id: string,
    patch: Partial<Omit<SideTab, "id" | "createdAt">>,
  ): void {
    const tabs = this.#sideTabsByMain.get(bucket) ?? [];
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const prev = tabs[idx]!;
    this.#sideTabsByMain.set(bucket, [
      ...tabs.slice(0, idx),
      { ...prev, ...patch },
      ...tabs.slice(idx + 1),
    ]);
    this.#emit();
  }

  closeSideTab(id: string): void {
    this.#closeSideTabForBucket(this.#sideBucket(), id);
  }

  closeSideTabForTask(taskId: string, id: string): void {
    this.#closeSideTabForBucket(taskId, id);
  }

  #closeSideTabForBucket(bucket: string | null, id: string): void {
    const tabs = this.#sideTabsByMain.get(bucket) ?? [];
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    const nextTabs = tabs.filter((t) => t.id !== id);
    if (nextTabs.length === 0) this.#sideTabsByMain.delete(bucket);
    else this.#sideTabsByMain.set(bucket, nextTabs);
    if (this.#activeSideTabByMain.get(bucket) === id) {
      const next = nextTabs[nextTabs.length - 1] ?? null;
      if (next) this.#activeSideTabByMain.set(bucket, next.id);
      else this.#activeSideTabByMain.delete(bucket);
    }
    if (this.#activeBrowserTabByMain.get(bucket) === id) {
      const nextBrowser = [...nextTabs].reverse().find((candidate) => candidate.type === "browser");
      if (nextBrowser) this.#activeBrowserTabByMain.set(bucket, nextBrowser.id);
      else this.#activeBrowserTabByMain.delete(bucket);
    }
    this.#syncVisibleSideSession(bucket);
    // Caller is responsible for tearing down the underlying resource:
    //   chat/subagent tabs → sessionDispose IPC
    //   terminal tabs → uiTermDispose IPC
    //   file/browser → no backing resource, nothing to do
    this.#emit();
  }

  setActiveSideTab(id: string | null): void {
    this.#setActiveSideTabForBucket(this.#sideBucket(), id);
  }

  setActiveSideTabForTask(taskId: string, id: string | null): void {
    this.#setActiveSideTabForBucket(taskId, id);
  }

  #setActiveSideTabForBucket(bucket: string | null, id: string | null): void {
    if (this.#activeSideTabByMain.get(bucket) === id) return;
    if (id) this.#activeSideTabByMain.set(bucket, id);
    else this.#activeSideTabByMain.delete(bucket);
    const tab = id
      ? (this.#sideTabsByMain.get(bucket) ?? []).find((candidate) => candidate.id === id)
      : null;
    if (tab?.type === "browser") {
      this.#activeBrowserTabByMain.set(bucket, tab.id);
    }
    this.#syncVisibleSideSession(bucket);
    this.#emit();
  }

  #syncVisibleSideSession(bucket: string | null): void {
    if (bucket !== this.#sideBucket()) return;
    const activeId = this.#activeSideTabByMain.get(bucket) ?? null;
    const tab = activeId
      ? (this.#sideTabsByMain.get(bucket) ?? []).find((candidate) => candidate.id === activeId)
      : null;
    this.#sideActiveId = tab && isSideSessionTab(tab.type) ? tab.payload : null;
  }

  /** Promote a side-chat session into a main one. Flips
   *  SessionRow.kind to "main" (the sidebar list filter then picks it
   *  up), removes the matching side-panel tab if any, and returns
   *  the id so the caller can navigate the router to /chat/$id.
   *  All of the session's turns + ACP child are preserved — only the
   *  UI category changes. */
  promoteSideToMain(sessionId: string): string | null {
    const row = this.#sessions.get(sessionId);
    if (!row || row.kind !== "side" || row.sideKind === "subagent") return null;
    this.#mutateSession(sessionId, (s) => ({
      ...s,
      kind: "main",
      sideKind: undefined,
      sideParent: undefined,
    }));
    // Drop the side-panel tab that wraps this chat. closeSideTab
    // would also tear down the ACP child — we want to keep it, so
    // just splice the tab out by hand.
    const tabs = this.#tabsBucket();
    const tabIdx = tabs.findIndex(
      (t) => t.type === "chat" && t.payload === sessionId,
    );
    if (tabIdx >= 0) {
      const wasActive = this.#activeBucket() === tabs[tabIdx]?.id;
      const nextTabs = [
        ...tabs.slice(0, tabIdx),
        ...tabs.slice(tabIdx + 1),
      ];
      this.#setTabsBucket(nextTabs);
      if (wasActive) {
        const next = nextTabs[nextTabs.length - 1] ?? null;
        this.#setActiveBucket(next?.id ?? null);
        this.#sideActiveId = next && isSideSessionTab(next.type) ? next.payload : null;
      }
    }
    if (this.#sideActiveId === sessionId) this.#sideActiveId = null;
    this.#activeId = sessionId;
    this.#emit();
    return sessionId;
  }

  // -------- Workspace artifacts (推荐 feed) --------

  artifactsFor(sessionId: string): WorkspaceArtifacts {
    return this.#artifactsBySession.get(sessionId) ?? { files: [], services: [] };
  }

  /** Merge new file paths + service URLs into the session's
   *  artifacts. Newest-first ordering; re-observed entries bubble to
   *  the top. Capped at 50 each to bound memory in long runs. */
  #ingestArtifacts(
    sessionId: string,
    files: string[],
    services: string[],
  ): void {
    if (files.length === 0 && services.length === 0) return;
    const prev = this.#artifactsBySession.get(sessionId) ?? {
      files: [],
      services: [],
    };
    const nextFiles = files.length > 0 ? dedupeBubble(prev.files, files, 50) : prev.files;
    const nextServices =
      services.length > 0 ? dedupeBubble(prev.services, services, 50) : prev.services;
    if (nextFiles === prev.files && nextServices === prev.services) return;
    this.#artifactsBySession.set(sessionId, {
      files: nextFiles,
      services: nextServices,
    });
  }

  /** Open any new *.html artifacts in the side BrowserTab so the user
   *  sees the agent's output rendered without leaving the app. Skipped
   *  if a browser tab for that URL is already open in this session's
   *  rail, and idempotent across repeated tool_call_update events via
   *  `#autoOpenedHtmlBySession`. The "side rail" we look at is the
   *  main session's bucket (the rail switches with the active main
   *  session, matching openSideTab's own targeting). */
  #autoOpenHtml(sessionId: string, htmlPaths: string[]): void {
    const seen = this.#autoOpenedHtmlBySession.get(sessionId) ?? new Set();
    const fresh = htmlPaths.filter((p) => !seen.has(p));
    if (fresh.length === 0) return;
    // Only act for the active main session — silently registering an
    // already-seen path for background sessions so they don't pop a
    // tab the moment the user switches over.
    if (this.#activeId !== sessionId) {
      for (const p of fresh) seen.add(p);
      this.#autoOpenedHtmlBySession.set(sessionId, seen);
      return;
    }
    const tabs = this.#tabsBucket();
    for (const p of fresh) {
      const url = "file://" + p;
      const already = tabs.some(
        (t) => t.type === "browser" && t.payload === url,
      );
      if (!already) {
        // openSideTab handles emit/active-set; we don't need to
        // duplicate that bookkeeping here.
        this.openSideTab("browser", url, basename(p));
      }
      seen.add(p);
    }
    this.#autoOpenedHtmlBySession.set(sessionId, seen);
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
      label: "",
      status: "draft",
      createdAt: Date.now(),
    });
    this.#activeId = id;
    this.#emit();
    return id;
  }

  /** Cold-create a side-chat draft. Same shape as newDraft but marks
   *  the row with `kind: "side"` (so it never appears in the sidebar
   *  list) and assigns the new id to `#sideActiveId` instead of the
   *  main active pointer. The main thread is left undisturbed. */
  newSideDraft(opts?: {
    parentSessionId?: string;
    parentAcpSessionId?: string;
    inheritance?: SubagentInheritance;
    agentId?: string;
    cwd?: string;
  }): string {
    const id = `side-${Math.random().toString(36).slice(2, 10)}`;
    this.#sessions.set(id, {
      id,
      agent_id: opts?.agentId ?? "",
      cwd: opts?.cwd ?? "",
      acp_session_id: "",
      label: "",
      kind: "side",
      sideKind: "chat",
      status: "draft",
      createdAt: Date.now(),
      sideParent: opts?.parentSessionId
        ? {
            parentSessionId: opts.parentSessionId,
            parentAcpSessionId: opts.parentAcpSessionId,
            inheritance: opts.inheritance ?? "fresh",
          }
        : undefined,
    });
    this.#sideActiveId = id;
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
  registerTurn(
    turnId: string,
    sessionId: string,
    promptText: string,
    delivery?: TurnDeliveryMeta,
  ): void {
    const row = this.#sessions.get(sessionId);
    const isQueued = !!row?.activeTurnId;
    this.#turns.set(turnId, {
      id: turnId,
      sessionId,
      promptText,
      events: [],
      assistantText: "",
      thoughtText: "",
      status: isQueued ? "queued" : "running",
      promptIntent: delivery?.intent,
      requestedDelivery: delivery?.requestedDelivery,
      effectiveDelivery: delivery?.effectiveDelivery,
      deliveryDegraded: delivery?.degraded,
      startedAt: Date.now(),
    });
    this.#mutateSession(sessionId, (s) => ({
      ...s,
      activeTurnId: s.activeTurnId ?? turnId,
      queuedTurnIds: s.activeTurnId
        ? [...(s.queuedTurnIds ?? []), turnId]
        : s.queuedTurnIds,
      status: "running",
    }));
    this.#recordSubagentActivity(sessionId, {
      task: promptText,
      status: "running",
    });
    this.#emit();
  }

  #markTurnRunning(turnId: string | undefined): void {
    if (!turnId) return;
    const turn = this.#turns.get(turnId);
    if (turn?.status === "queued") {
      this.#turns.set(turnId, { ...turn, status: "running" });
    }
  }

  #advanceAfterTurn(sessionId: string, turnId: string, opts?: { unread?: boolean }): void {
    this.#mutateSession(sessionId, (s) => {
      const queued = s.queuedTurnIds ?? [];
      if (s.activeTurnId === turnId) {
        const [nextTurnId, ...rest] = queued;
        this.#markTurnRunning(nextTurnId);
        return {
          ...s,
          activeTurnId: nextTurnId,
          queuedTurnIds: rest.length ? rest : undefined,
          status: nextTurnId ? "running" : "ready",
          unread: opts?.unread ? true : s.unread,
        };
      }

      const rest = queued.filter((id) => id !== turnId);
      return {
        ...s,
        queuedTurnIds: rest.length ? rest : undefined,
        unread: opts?.unread ? true : s.unread,
      };
    });
  }

  /** Replace one row with a new object (immutable update). Keeps React happy
   *  with referential-equality identity tracking — see #snapshotCache and the
   *  comment in apply() below. */
  #mutateSession(id: string, update: (prev: SessionRow) => SessionRow): void {
    const prev = this.#sessions.get(id);
    if (!prev) return;
    this.#sessions.set(id, update(prev));
  }

  #recordSubagentActivity(
    childSessionId: string,
    patch: Partial<Pick<SubagentActivity, "task" | "status" | "errorMessage">>,
  ): void {
    const row = this.#sessions.get(childSessionId);
    const link = row?.subagent;
    if (!row || !link) return;

    const now = Date.now();
    const prevList = this.#subagentsByParent.get(link.parentSessionId) ?? [];
    const idx = prevList.findIndex((a) => a.childSessionId === childSessionId);
    const prev = idx >= 0 ? prevList[idx] : undefined;
    const next: SubagentActivity = {
      parentSessionId: link.parentSessionId,
      parentAcpSessionId: link.parentAcpSessionId,
      childSessionId,
      viewSessionId: prev?.viewSessionId ?? childSessionId,
      inheritance: link.inheritance,
      task: patch.task ?? prev?.task ?? row.label,
      status: patch.status ?? prev?.status ?? "draft",
      startedAt: prev?.startedAt ?? now,
      updatedAt: now,
      errorMessage: patch.errorMessage,
    };
    const nextList =
      idx >= 0
        ? [
            ...prevList.slice(0, idx),
            next,
            ...prevList.slice(idx + 1),
          ]
        : [...prevList, next];
    this.#subagentsByParent.set(link.parentSessionId, nextList);
  }

  #ingestNativeAgentToolEvent(
    parentSessionId: string,
    tool: { toolCallId: string; parentToolUseId?: string },
  ): void {
    const expectedProvider = nativeProviderForAgent(
      this.#sessions.get(parentSessionId)?.agent_id,
    );
    const context =
      this.#nativeAgentContextByToolCall.get(tool.toolCallId) ??
      (tool.parentToolUseId
        ? this.#nativeAgentContextByToolCall.get(tool.parentToolUseId)
        : undefined);
    const sameParentContext =
      context?.parentSessionId === parentSessionId ? context : undefined;
    const updates = detectNativeAgentToolEvent(tool, sameParentContext);
    this.#ingestNativeAgentUpdates(
      parentSessionId,
      expectedProvider
        ? updates.filter((update) => update.provider === expectedProvider)
        : updates.filter((update) => update.provider === "codex"),
    );
  }

  #ingestNativeAgentUpdates(parentSessionId: string, updates: NativeAgentUpdate[]): void {
    for (const update of updates) {
      this.#upsertNativeSubagentActivity(parentSessionId, update);
    }
  }

  #upsertNativeSubagentActivity(parentSessionId: string, update: NativeAgentUpdate): void {
    const existingContext = update.toolCallId
      ? this.#nativeAgentContextByToolCall.get(update.toolCallId)
      : undefined;
    const childSessionId =
      update.childId ??
      existingContext?.childId ??
      (update.toolCallId ? `${update.provider}:${update.toolCallId}` : undefined);
    if (!childSessionId) return;

    const parent = this.#sessions.get(parentSessionId);
    const now = Date.now();
    const prevList = this.#subagentsByParent.get(parentSessionId) ?? [];
    let idx = prevList.findIndex((a) => a.childSessionId === childSessionId);
    if (idx < 0 && existingContext?.childId && existingContext.childId !== childSessionId) {
      idx = prevList.findIndex((a) => a.childSessionId === existingContext.childId);
    }
    const prev = idx >= 0 ? prevList[idx] : undefined;
    const native: NativeSubagentMetadata = {
      ...(prev?.native ?? {}),
      provider: update.provider,
      toolCallId: update.toolCallId ?? prev?.native?.toolCallId,
      childThreadId: nativeChildThreadId(update) ?? prev?.native?.childThreadId,
      nickname: update.nickname ?? prev?.native?.nickname,
      agentType: update.agentType ?? prev?.native?.agentType,
      forkContext: update.forkContext ?? prev?.native?.forkContext,
      result: update.result ?? prev?.native?.result,
      closed: update.closed ?? prev?.native?.closed,
      childToolCallIds: appendUnique(
        prev?.native?.childToolCallIds,
        update.childToolCallId,
      ),
    };
    const next: SubagentActivity = {
      parentSessionId,
      parentAcpSessionId: parent?.acp_session_id || prev?.parentAcpSessionId,
      childSessionId,
      viewSessionId:
        prev?.viewSessionId ??
        `native-subagent-${Math.random().toString(36).slice(2, 10)}`,
      inheritance:
        update.forkContext === true
          ? "fork"
          : update.forkContext === false
            ? "fresh"
            : prev?.inheritance ?? "fresh",
      task: update.task ?? prev?.task ?? parent?.label ?? "",
      status: update.status ?? prev?.status ?? "running",
      startedAt: prev?.startedAt ?? now,
      updatedAt: now,
      errorMessage: update.errorMessage ?? prev?.errorMessage,
      native,
    };
    const nextList =
      idx >= 0
        ? [
            ...prevList.slice(0, idx),
            next,
            ...prevList.slice(idx + 1),
          ]
        : [...prevList, next];
    this.#subagentsByParent.set(parentSessionId, nextList);
    this.#syncNativeSubagentView(parentSessionId, next);

    if (update.toolCallId) {
      this.#nativeAgentContextByToolCall.set(update.toolCallId, {
        provider: update.provider,
        operation: update.operation ?? existingContext?.operation,
        toolCallId: update.toolCallId,
        childId: childSessionId,
        parentSessionId,
      });
    }
  }

  /** Materialize provider-native activity as an ordinary side-session view.
   *  ChatView then renders native children with the exact same conversation
   *  surface as GUI-created side chats. Only the data source differs: the
   *  task is the user turn and the structured native result is the assistant
   *  turn. */
  #syncNativeSubagentView(
    parentSessionId: string,
    activity: SubagentActivity,
  ): void {
    const parent = this.#sessions.get(parentSessionId);
    if (!parent) return;

    const viewSessionId = activity.viewSessionId;
    const turnId = `${viewSessionId}:turn`;
    const label = subagentActivityLabel(activity);
    const rowStatus = nativeActivitySessionStatus(activity.status);
    const turnStatus = nativeActivityTurnStatus(activity.status);
    const previousRow = this.#sessions.get(viewSessionId);
    const previousTurn = this.#turns.get(turnId);

    this.#sessions.set(viewSessionId, {
      ...previousRow,
      id: viewSessionId,
      agent_id: parent.agent_id,
      cwd: parent.cwd,
      acp_session_id:
        activity.native?.childThreadId ?? previousRow?.acp_session_id ?? "",
      label,
      kind: "side",
      sideKind: "subagent",
      subagent: {
        parentSessionId,
        parentAcpSessionId: activity.parentAcpSessionId,
        inheritance: activity.inheritance,
      },
      status: rowStatus,
      lastError: activity.errorMessage,
      createdAt: previousRow?.createdAt ?? activity.startedAt,
      activeTurnId: turnStatus === "running" ? turnId : undefined,
    });

    this.#turns.set(turnId, {
      id: turnId,
      sessionId: viewSessionId,
      promptText: activity.task,
      events: previousTurn?.events ?? [],
      assistantText:
        activity.native?.result ?? previousTurn?.assistantText ?? "",
      thoughtText: previousTurn?.thoughtText ?? "",
      status: turnStatus,
      errorMessage: activity.errorMessage,
      startedAt: previousTurn?.startedAt ?? activity.startedAt,
      endedAt:
        turnStatus === "running"
          ? undefined
          : previousTurn?.endedAt ?? activity.updatedAt,
    });

    const tabs = this.#sideTabsByMain.get(parentSessionId) ?? [];
    // Clean up the short-lived aggregate tab from older hot-reloaded builds.
    const withoutLegacy = tabs.filter(
      (tab) =>
        !(
          tab.type === "subagent" &&
          tab.payload === parentSessionId &&
          tab.label === "Subagents"
        ),
    );
    const tabIndex = withoutLegacy.findIndex(
      (tab) => tab.type === "subagent" && tab.payload === viewSessionId,
    );

    if (tabIndex < 0) {
      if (withoutLegacy.length !== tabs.length) {
        this.#sideTabsByMain.set(parentSessionId, withoutLegacy);
      }
      this.#openSideTabForBucket(
        parentSessionId,
        "subagent",
        viewSessionId,
        label,
      );
      return;
    }

    const tab = withoutLegacy[tabIndex]!;
    if (tab.label !== label || withoutLegacy.length !== tabs.length) {
      this.#sideTabsByMain.set(parentSessionId, [
        ...withoutLegacy.slice(0, tabIndex),
        { ...tab, label },
        ...withoutLegacy.slice(tabIndex + 1),
      ]);
    }
  }

  #isPairMember(sessionId: string): boolean {
    for (const pair of this.#pairs.values()) {
      if (pair.members.includes(sessionId)) return true;
    }
    return false;
  }

  #persistPair(pair: PairRow): void {
    if (typeof window === "undefined" || !window.backchat?.pairSave) return;
    void window.backchat.pairSave({
      pair_id: pair.id,
      title: pair.label,
      members: pair.members
        .map((sid) => this.#sessions.get(sid))
        .filter((s): s is SessionRow => !!s)
        .map((s) => ({
          session_id: s.id,
          agent_id: s.agent_id,
          cwd: s.cwd,
        })),
    });
  }

  seedPersistedPairGroups(
    rows: import("@shared/api.js").PersistedPairInfo[],
  ): void {
    let changed = false;
    for (const r of rows) {
      if (!r.id || r.members.length < 2) continue;
      const prev = this.#pairs.get(r.id);
      this.#pairs.set(r.id, {
        id: r.id,
        label: r.title || prev?.label || "",
        members: r.members.map((m) => m.id),
        lastUsedAt: r.last_used_at || prev?.lastUsedAt || Date.now(),
        createdAt: r.created_at || prev?.createdAt || Date.now(),
        activeTurnId: prev?.activeTurnId,
        memberTurnIds: prev?.memberTurnIds,
        pendingMembers: prev?.pendingMembers,
      });
      for (const member of r.members) {
        if (this.#sessions.has(member.id)) {
          this.#mutateSession(member.id, (s) => ({
            ...s,
            agent_id: member.agent_id,
            cwd: member.cwd,
            acp_session_id: member.acp_session_id || s.acp_session_id,
            label: member.title || s.label,
            kind: "pair",
            pinnedAt: member.pinned_at ?? undefined,
            archivedAt: member.archived_at ?? undefined,
          }));
        } else {
          this.#sessions.set(member.id, {
            id: member.id,
            agent_id: member.agent_id,
            cwd: member.cwd,
            acp_session_id: member.acp_session_id,
            label: member.title || `${member.agent_id} · ${member.id.slice(0, 6)}`,
            kind: "pair",
            status: "ready",
            createdAt: member.created_at,
            pinnedAt: member.pinned_at ?? undefined,
            archivedAt: member.archived_at ?? undefined,
          });
        }
      }
      changed = true;
    }
    if (changed) this.#emit();
  }

  /** Seed the in-memory store with persisted rows fetched from the SQLite
   *  backing on app launch. Rows land with status="ready" — no IPC is
   *  fired; the actual ACP child is spawned lazily on first prompt. */
  seedPersisted(
    rows: Array<{
      id: string;
      agent_id: string;
      cwd: string;
      acp_session_id: string;
      title: string;
      last_used_at: number;
      created_at: number;
      pinned_at?: number | null;
      archived_at?: number | null;
    }>,
  ): void {
    for (const r of rows) {
      if (this.#sessions.has(r.id)) {
        // Existing row — patch the persisted metadata that may have
        // changed since the in-memory copy was created. Without this
        // step, a row created live (via registerTurn / session.ready)
        // before the first reload of this metadata would never learn
        // about pinned_at / archived_at. status / agent_id / cwd
        // also flow through here so a future "discover persisted
        // state on launch" reuses the same path.
        this.#mutateSession(r.id, (s) => ({
          ...s,
          agent_id: r.agent_id,
          cwd: r.cwd,
          acp_session_id: r.acp_session_id || s.acp_session_id,
          label: r.title || s.label,
          kind: this.#isPairMember(r.id) ? "pair" : s.kind,
          createdAt: r.created_at || s.createdAt,
          pinnedAt: r.pinned_at ?? undefined,
          archivedAt: r.archived_at ?? undefined,
        }));
        continue;
      }
      this.#sessions.set(r.id, {
        id: r.id,
        agent_id: r.agent_id,
        cwd: r.cwd,
        acp_session_id: r.acp_session_id,
        label: r.title || "New chat",
        kind: this.#isPairMember(r.id) ? "pair" : undefined,
        status: "ready",
        createdAt: r.created_at,
        pinnedAt: r.pinned_at ?? undefined,
        archivedAt: r.archived_at ?? undefined,
      });
    }
    this.#emit();
  }

  /** Replay persisted events into a turn structure so the chat view can
   *  render history. `events` rows come from sessions.loadHistory; we
   *  collapse them into one Turn per user_prompt boundary so the visual
   *  matches a live conversation. */
  replayHistory(
    sessionId: string,
    rows: Array<{ seq: number; type: string; data: string; ts: number }>,
  ): void {
    // Skip replay entirely if this session already has turns in the
    // store. The in-memory turns from the live session are authoritative
    // — only first-time mounts (after a renderer reload) actually need
    // to materialize SQL history into turn structures. Without this
    // guard, wiping and re-creating turns from SQL kills the user's
    // currently-streaming bubble.
    const hasTurns = [...this.#turns.values()].some(
      (t) => t.sessionId === sessionId,
    );
    if (hasTurns) return;
    let current: Turn | null = null;
    let order = 0;
    for (const r of rows) {
      const data = safeParse(r.data);
      if (r.type === "user_prompt") {
        // Flush the previous turn, start a new one.
        if (current) this.#turns.set(current.id, current);
        const tid = `replay-${sessionId}-${order++}`;
        current = {
          id: tid,
          sessionId,
          promptText: (data as { text?: string })?.text ?? "",
          events: [],
          assistantText: "",
          thoughtText: "",
          status: "complete",
          startedAt: r.ts,
          endedAt: r.ts,
        };
      } else if (current) {
        // Every non-user_prompt row is a stored ACP event. Structural
        // events stay verbatim; adjacent text/thought chunks are compacted
        // into runs so long histories do not rebuild thousands of token
        // objects. Tool boundaries remain in place, preserving the same
        // live ordering. For back-compat, also accept legacy coalesced
        // `agent_message` / `agent_thought` rows.
        if (r.type === "agent_message") {
          const text = (data as { text?: string })?.text ?? "";
          current.assistantText += text;
          this.#appendStreamEvent(current, "text", text, r.ts);
        } else if (r.type === "agent_thought") {
          const text = (data as { text?: string })?.text ?? "";
          current.thoughtText += text;
          this.#appendStreamEvent(current, "thought", text, r.ts);
        } else {
          // New persisted chunks are stored as the raw ACP event under
          // each row's `data`. They already have sessionUpdate /
          // content fields, so reduceTurn consumes them directly.
          const parsed = parseAcpEvent(data);
          if (parsed.kind === "text") {
            current.assistantText = mergeStreamingText(current.assistantText, parsed.text);
            this.#appendStreamEvent(current, "text", parsed.text, r.ts);
          } else if (parsed.kind === "thought") {
            current.thoughtText = mergeStreamingText(current.thoughtText, parsed.text);
            this.#appendStreamEvent(current, "thought", parsed.text, r.ts);
          } else {
            current.events.push({ payload: data, receivedAt: r.ts });
          }
        }
      }
    }
    if (current) this.#turns.set(current.id, current);
    this.#emit();
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
        const configOptions = normalizeConfigOptions(ev.config_options);
        if (existing) {
          this.#mutateSession(ev.session_id, (s) => ({
            ...s,
            acp_session_id: ev.acp_session_id,
            agent_id: ev.agent_id,
            cwd: ev.cwd,
            configOptions: configOptions ?? s.configOptions,
            currentModeId:
              selectedModeIdFromConfigOptions(configOptions) ?? s.currentModeId,
            supportsSessionFork: ev.supports_session_fork ?? s.supportsSessionFork,
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
            configOptions,
            currentModeId: selectedModeIdFromConfigOptions(configOptions),
            supportsSessionFork: ev.supports_session_fork,
          });
        }
        if (!this.#activeId) this.#activeId = ev.session_id;
        break;
      }
      case "session.event": {
        // Some ACP session updates are session-scoped, not turn-scoped —
        // available_commands_update declares the agent's slash command
        // catalog, current_mode_update names the agent's active mode.
        // Both replace prior state on the SessionRow and DO NOT need a
        // matching Turn (they often arrive between turns or right after
        // session.new). Branch on these before the turn-lookup path so
        // we don't synthesize an empty turn just to hold a session-level
        // payload.
        const inner = sessionUpdateInner(ev.event);
        const updateType = sessionUpdateType(ev.event);
        const parsed = parseAcpEvent(ev.event);
        if (parsed.kind === "commands") {
          this.#mutateSession(ev.session_id, (s) => ({
            ...s,
            availableCommands: parsed.commands,
          }));
          break;
        }
        if (updateType === "current_mode_update") {
          const currentModeId =
            typeof inner.currentModeId === "string"
              ? inner.currentModeId
              : typeof inner.current_mode_id === "string"
                ? inner.current_mode_id
                : undefined;
          this.#mutateSession(ev.session_id, (s) => ({
            ...s,
            currentModeId,
          }));
          break;
        }
        if (updateType === "config_option_update") {
          const rawConfigOptions = Array.isArray(inner.configOptions)
            ? inner.configOptions
            : Array.isArray(inner.config_options)
              ? inner.config_options
              : undefined;
          const configOptions = normalizeConfigOptions(rawConfigOptions) ?? [];
          this.#mutateSession(ev.session_id, (s) => ({
            ...s,
            configOptions,
            currentModeId:
              selectedModeIdFromConfigOptions(configOptions) ?? s.currentModeId,
          }));
          break;
        }
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
        if (parsed.kind === "text" || parsed.kind === "thought") {
          const text = parsed.text;
          if (text.length > 0) {
            // In-place mutate (intentional). React doesn't read this field
            // during the stream — only on turn-complete unmount-and-replace
            // — so identity stability is irrelevant here. The savings:
            // tens of thousands of avoided reconciliations per long turn.
            if (parsed.kind === "text") {
              const next = mergeStreamingText(turn.assistantText, text);
              const delta = next.startsWith(turn.assistantText)
                ? next.slice(turn.assistantText.length)
                : "";
              turn.assistantText = next;
              if (delta) this.#emitStream(ev.turn_id, { kind: "assistant", text: delta });
            } else {
              const next = mergeStreamingText(turn.thoughtText, text);
              const delta = next.startsWith(turn.thoughtText)
                ? next.slice(turn.thoughtText.length)
                : "";
              turn.thoughtText = next;
              if (delta) this.#emitStream(ev.turn_id, { kind: "thought", text: delta });
            }
            // Preserve timeline ordering without retaining one array entry
            // per token. React is deliberately asleep in this branch; the
            // next structural event/turn completion publishes the compacted
            // event list.
            this.#appendStreamEvent(turn, parsed.kind, text, Date.now());
            return;
          }
        }

        // Structural event — replace events array AND bump version so React
        // re-renders the affected turn block.
        this.#turns.set(ev.turn_id, {
          ...turn,
          events: [...turn.events, { payload: ev.event, receivedAt: Date.now() }],
        });
        if (nativeProviderForAgent(this.#sessions.get(ev.session_id)?.agent_id) === "codex") {
          this.#ingestNativeAgentUpdates(
            ev.session_id,
            detectNativeAgentRawEvent(ev.event),
          );
        }
        // Sniff tool_call payloads for workspace artifacts: file paths
        // from rawInput, localhost service URLs from rawOutput. These
        // feed the side panel's 推荐 tile so the user can jump to
        // whatever the agent just touched.
        if (parsed.kind === "tool_call") {
          const tool = parsed.tool;
          this.#ingestNativeAgentToolEvent(ev.session_id, tool);
          const files = extractFilePaths(tool.rawInput);
          const services = extractServiceUrls(tool.rawOutput);
          this.#ingestArtifacts(ev.session_id, files, services);
          // Auto-open HTML produced/opened by the agent in the side
          // BrowserTab. Two trigger shapes:
          //   - execute tool with `open /abs/x.html` in the command
          //   - any tool whose extracted file path ends in .html and
          //     references an absolute file we can serve via file://
          // We only fire on completed events so we don't repeatedly
          // open the same tab on tool_call → tool_call_update flips.
          if (tool.status === "completed") {
            const fromExec = extractHtmlPathsFromExecute(tool.rawInput);
            // For file-shaped tools (write/edit) the path can be
            // absolute or cwd-relative. Resolve relatives against the
            // session's cwd so an agent that emitted `index.html` as
            // a write path still triggers an auto-open.
            const sessCwd = this.#sessions.get(ev.session_id)?.cwd ?? "";
            const fromFiles = files
              .filter((f) => /\.html?$/i.test(f))
              .map((f) => (f.startsWith("/") ? f : sessCwd ? sessCwd.replace(/\/$/, "") + "/" + f.replace(/^\.\//, "") : ""))
              .filter((f) => f.startsWith("/"));
            const candidates = Array.from(new Set([...fromExec, ...fromFiles]));
            if (candidates.length > 0) {
              this.#autoOpenHtml(ev.session_id, candidates);
            }
          }
        }
        break;
      }
      case "session.native_subagent": {
        this.#ingestNativeAgentUpdates(ev.session_id, [
          {
            provider: ev.provider,
            operation:
              ev.provider === "claude"
                ? "claude_agent"
                : undefined,
            toolCallId: ev.tool_call_id,
            childId: ev.child_id,
            task: ev.task,
            agentType: ev.agent_type,
            status: ev.status,
            result: ev.result,
            errorMessage: ev.error_message,
          },
        ]);
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
        // Mark unread ONLY if the user wasn't looking at this session
        // when the turn finished — there's nothing to "notify" about
        // a chat you're actively reading. The dot clears as soon as
        // they navigate to this session (setActive).
        const isBackgroundChat = this.#activeId !== ev.session_id;
        this.#advanceAfterTurn(ev.session_id, ev.turn_id, {
          unread: isBackgroundChat,
        });
        this.#recordSubagentActivity(ev.session_id, { status: "complete" });
        this.#dropPairPendingForSession(ev.session_id, ev.turn_id);
        break;
      }
      case "session.queue_update": {
        this.#mutateSession(ev.session_id, (s) => ({
          ...s,
          activeTurnId: ev.active_turn_id ?? undefined,
          queuedPrompts: ev.queued,
          status: ev.active_turn_id ? "running" : s.status === "running" ? "ready" : s.status,
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
          this.#advanceAfterTurn(ev.session_id, ev.turn_id);
          this.#recordSubagentActivity(ev.session_id, {
            status: "error",
            errorMessage: ev.message,
          });
          this.#dropPairPendingForSession(ev.session_id, ev.turn_id);
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
        this.#recordSubagentActivity(ev.session_id, { status: "cancelled" });
        this.#mutateSession(ev.session_id, (s) => ({ ...s, status: "disposed" }));
        if (this.#activeId === ev.session_id) {
          const fallback = [...this.#sessions.values()].find(
            (s) =>
              s.id !== ev.session_id &&
              s.status !== "disposed" &&
              s.kind !== "side",
          );
          this.#activeId = fallback?.id ?? null;
        }
        if (this.#sideActiveId === ev.session_id) {
          // Side chat is a single-slot rail — no fallback peer. Just
          // clear the pointer so the rail shows the empty "+ start side
          // chat" affordance again.
          this.#sideActiveId = null;
        }
        this.#sessions.delete(ev.session_id);
        this.#autoOpenedHtmlBySession.delete(ev.session_id);
        for (const [tid, turn] of this.#turns) {
          if (turn.sessionId === ev.session_id) this.#turns.delete(tid);
        }
        break;
      }
    }
    this.#emit();
  }

  // -------------------- pair-chat surface --------------------

  /** All pairs in display order (most-recent first). */
  pairList(): PairRow[] {
    return [...this.#pairs.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  pair(id: string): PairRow | null {
    return this.#pairs.get(id) ?? null;
  }

  /** Mint a fresh draft pair from the renderer. Doesn't fire IPC yet —
   *  on first submit the composer starts and prompts each member via
   *  the ordinary session API. Members each get a draft single-session
   *  row so the existing reducer / TurnBlock machinery works unchanged. */
  newDraftPair(agentIds: string[]): string {
    const pair_id = `pair-${Math.random().toString(36).slice(2, 10)}`;
    const members: string[] = [];
    const now = Date.now();
    for (const agentId of agentIds) {
      const sid = `sess-${Math.random().toString(36).slice(2, 10)}`;
      this.#sessions.set(sid, {
        id: sid,
        agent_id: agentId,
        cwd: "",
        acp_session_id: "",
        label: `${agentId} · ${sid.slice(0, 6)}`,
        status: "draft",
        kind: "pair",
        createdAt: now,
      });
      members.push(sid);
    }
    this.#pairs.set(pair_id, {
      id: pair_id,
      label: "",
      members,
      lastUsedAt: now,
      createdAt: now,
    });
    this.#persistPair(this.#pairs.get(pair_id)!);
    this.#emit();
    return pair_id;
  }

  /** Translate a PairEventOut into the session-event reducer + update
   *  pair turn state. Subscribed in the bootstrap below. */
  applyPair(ev: import("@shared/pair-events.js").PairEventOut): void {
    switch (ev.type) {
      case "pair.ready": {
        // Each member's metadata maps onto a SessionRow (creating if
        // the renderer hasn't seeded it — e.g. coming back after a
        // reload before pairsList replayed).
        for (const m of ev.members) {
          this.apply({
            type: "session.ready",
            session_id: m.session_id,
            acp_session_id: m.acp_session_id,
            agent_id: m.agent_id,
            cwd: m.cwd,
          });
          // Hide the just-materialized member behind the pair sidebar row.
          this.#mutateSession(m.session_id, (s) => ({ ...s, kind: "pair" }));
        }
        // Refresh pair members in case backend invented session ids
        // we don't know (resume path).
        const pair = this.#pairs.get(ev.pair_id);
        if (pair) {
          pair.members = ev.members.map((m) => m.session_id);
          pair.lastUsedAt = Date.now();
        } else {
          const now = Date.now();
          this.#pairs.set(ev.pair_id, {
            id: ev.pair_id,
            label: "",
            members: ev.members.map((m) => m.session_id),
            lastUsedAt: now,
            createdAt: now,
          });
        }
        this.#persistPair(this.#pairs.get(ev.pair_id)!);
        this.#emit();
        return;
      }
      case "pair.event": {
        this.apply({
          type: "session.event",
          session_id: ev.member_session_id,
          turn_id: ev.turn_id,
          event: ev.event,
        });
        return;
      }
      case "pair.complete": {
        this.apply({
          type: "session.complete",
          session_id: ev.member_session_id,
          turn_id: ev.turn_id,
        });
        this.#dropPairPending(ev.pair_id, ev.member_session_id);
        return;
      }
      case "pair.error": {
        this.apply({
          type: "session.error",
          session_id: ev.member_session_id,
          turn_id: ev.turn_id,
          message: ev.message,
        });
        if (ev.member_session_id) {
          this.#dropPairPending(ev.pair_id, ev.member_session_id);
        }
        return;
      }
      case "pair.disposed": {
        this.#pairs.delete(ev.pair_id);
        this.#emit();
        return;
      }
    }
  }

  /** Mark a member done for the active pair turn. When all members
   *  are done, clear the pair-wide activeTurnId so the composer
   *  re-enables. */
  #dropPairPending(
    pair_id: string,
    member_session_id: string,
    turn_id?: string,
  ): void {
    const pair = this.#pairs.get(pair_id);
    if (!pair || !pair.pendingMembers) return;
    if (turn_id && pair.memberTurnIds?.[member_session_id] !== turn_id) return;
    pair.pendingMembers.delete(member_session_id);
    if (pair.pendingMembers.size === 0) {
      pair.activeTurnId = undefined;
      pair.pendingMembers = undefined;
      pair.memberTurnIds = undefined;
      pair.lastUsedAt = Date.now();
      this.#persistPair(pair);
      this.#emit();
    }
  }

  #dropPairPendingForSession(session_id: string, turn_id: string): void {
    for (const pair of this.#pairs.values()) {
      if (!pair.pendingMembers?.has(session_id)) continue;
      this.#dropPairPending(pair.id, session_id, turn_id);
      return;
    }
  }

  /** Register a fan-out turn — paint the same user prompt under every
   *  member immediately, lock the pair composer, then return one
   *  ordinary session turn id per member. */
  registerPairTurn(pair_id: string, text: string): PairTurnTarget[] | null {
    const pair = this.#pairs.get(pair_id);
    if (!pair) return null;
    const groupTurnId = `pairturn-${Math.random().toString(36).slice(2, 10)}`;
    const targets: PairTurnTarget[] = pair.members.map((sid) => ({
      session_id: sid,
      turn_id: `turn-${Math.random().toString(36).slice(2, 10)}`,
    }));
    for (const sid of pair.members) {
      const target = targets.find((t) => t.session_id === sid);
      if (target) this.registerTurn(target.turn_id, sid, text);
    }
    pair.activeTurnId = groupTurnId;
    pair.pendingMembers = new Set(pair.members);
    pair.memberTurnIds = Object.fromEntries(
      targets.map((t) => [t.session_id, t.turn_id]),
    );
    pair.lastUsedAt = Date.now();
    if (!pair.label) pair.label = derivePairLabel(text);
    this.#persistPair(pair);
    this.#emit();
    return targets;
  }
}

export const sessionStore = new SessionStore();

function derivePairLabel(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split(/\r?\n/)[0]!;
  return firstLine.length <= 40 ? firstLine : firstLine.slice(0, 39).trimEnd() + "…";
}

// Bootstrap: subscribe to the main-process pair channel exactly once.
// All pair events route through sessionStore.applyPair, which translates
// them to single-session events for the existing reducer.
if (typeof window !== "undefined" && window.backchat?.onPairEvent) {
  window.backchat.onPairEvent((ev) => sessionStore.applyPair(ev));
}

/** Stable top-level selectors — pass these to `useSessionStore` instead of
 *  defining inline arrows. Inline arrows would create a fresh reference
 *  per render and miss the store's snapshot cache. */
export const selectSessions = (s: SessionStore) => s.list();
export const selectPairs = (s: SessionStore) => s.pairList();
export const selectActiveId = (s: SessionStore) => s.activeId();
export const selectActive = (s: SessionStore) => s.active();
export const selectSideActive = (s: SessionStore) => s.sideActive();
export const selectSideActiveId = (s: SessionStore) => s.sideActiveId();
export const selectSideTabs = (s: SessionStore) => s.sideTabs();
export const selectActiveSideTabId = (s: SessionStore) => s.activeSideTabId();
export const selectActiveSideTab = (s: SessionStore) => s.activeSideTab();
export const selectBrowserWindows = (s: SessionStore) => s.browserWindows();
export const selectArtifactsFor =
  (sessionId: string | null | undefined) => (s: SessionStore) =>
    sessionId ? s.artifactsFor(sessionId) : { files: [], services: [] };
export const selectSubagentsFor =
  (sessionId: string | null | undefined) => (s: SessionStore) =>
    sessionId ? s.subagentsFor(sessionId) : [];
export const selectSubagentByChildId =
  (childSessionId: string | null | undefined) => (s: SessionStore) =>
    childSessionId ? s.subagentByChildId(childSessionId) : null;
export const selectTurnsFor = (sessionId: string) => (s: SessionStore) =>
  s.turnsFor(sessionId);

/** Imperative new-draft helper for routes that don't have a hook in scope. */
export function newDraftSession(): string {
  return sessionStore.newDraft();
}

/** Imperative side-chat draft helper — called by the right rail's
 *  "+ side chat" button. Returns the new session id; the caller does
 *  not need to navigate (side sessions don't appear in router URLs). */
export function newSideDraftSession(): string {
  return sessionStore.newSideDraft();
}

function defaultSideTabLabel(type: SideTabType, payload: string): string {
  switch (type) {
    case "chat":
      return "Side chat";
    case "subagent":
      return "子任务";
    case "file": {
      const trimmed = payload.replace(/\/+$/, "");
      const last = trimmed.split("/").pop();
      return last || "Files";
    }
    case "browser":
      try {
        const url = new URL(payload);
        return url.hostname || "Browser";
      } catch {
        return "Browser";
      }
    case "terminal": {
      const trimmed = payload.replace(/\/+$/, "");
      const last = trimmed.split("/").pop();
      return last || "Terminal";
    }
  }
}

function isSideSessionTab(type: SideTabType): boolean {
  return type === "chat" || type === "subagent";
}

function subagentActivityLabel(activity: SubagentActivity): string {
  const name =
    activity.native?.nickname ||
    activity.task ||
    activity.native?.agentType ||
    activity.childSessionId;
  return name.length <= 24 ? name : name.slice(0, 23).trimEnd() + "…";
}

function nativeActivitySessionStatus(
  status: SubagentActivity["status"],
): SessionRow["status"] {
  if (status === "error") return "errored";
  if (status === "complete" || status === "cancelled") return "ready";
  return "running";
}

function nativeActivityTurnStatus(
  status: SubagentActivity["status"],
): Turn["status"] {
  if (status === "complete") return "complete";
  if (status === "error") return "error";
  if (status === "cancelled") return "cancelled";
  return "running";
}

function nativeChildThreadId(update: NativeAgentUpdate): string | undefined {
  if (!update.childId) return undefined;
  return update.toolCallId && update.childId === `${update.provider}:${update.toolCallId}`
    ? undefined
    : update.childId;
}

function appendUnique(
  values: string[] | undefined,
  value: string | undefined,
): string[] | undefined {
  if (!value) return values;
  const next = values ? [...values] : [];
  if (!next.includes(value)) next.push(value);
  return next;
}

function nativeProviderForAgent(agentId: string | undefined): NativeAgentProvider | undefined {
  const normalized = (agentId ?? "").toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "codex-acp" || normalized.includes("codex")) return "codex";
  if (
    normalized === "claude-acp" ||
    normalized.includes("claude-code") ||
    normalized.includes("claude") ||
    normalized === "cc" ||
    normalized.startsWith("cc-")
  ) {
    return "claude";
  }
  return undefined;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeConfigOptions(
  value: readonly unknown[] | undefined,
): AcpSessionConfigOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter(isConfigOption);
  return out.length > 0 ? out : [];
}

function isConfigOption(value: unknown): value is AcpSessionConfigOption {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.name !== "string") return false;
  if (obj.category != null && typeof obj.category !== "string") return false;
  if (obj.type === "boolean") return typeof obj.currentValue === "boolean";
  if (obj.type !== "select") return false;
  return typeof obj.currentValue === "string" && Array.isArray(obj.options);
}

/** Merge `incoming` into `existing` newest-first, dropping duplicates
 *  and capping at `max`. Same-value re-observations bubble to index 0
 *  (most-recent-touched wins) rather than create a duplicate entry. */
function dedupeBubble(existing: string[], incoming: string[], max: number): string[] {
  if (incoming.length === 0) return existing;
  const out = [...incoming];
  const seen = new Set(out);
  for (const v of existing) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  // Identity stability: if no actual change, return the original
  // array reference so React shallow-equals selectors short-circuit.
  if (out.length === existing.length && out.every((v, i) => v === existing[i])) {
    return existing;
  }
  return out;
}

/** Pull file paths from a tool_call's rawInput. Walks common field
 *  names different agents use (Claude: `file_path` / `path`, Codex:
 *  `path` / `target_file`, Aider: `filename`). Best-effort — agents
 *  with custom shapes won't surface here, that's fine. */
function extractFilePaths(rawInput: unknown): string[] {
  if (!rawInput || typeof rawInput !== "object") return [];
  const obj = rawInput as Record<string, unknown>;
  const out: string[] = [];
  const KEYS = ["path", "file_path", "filepath", "file", "target_file", "filename"];
  for (const k of KEYS) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) out.push(v);
  }
  // Some tools take an array of paths (e.g. MultiEdit). Recurse one
  // level if `files` / `edits` looks like an array of objects with
  // path-ish fields.
  for (const k of ["files", "edits", "paths"]) {
    const v = obj[k];
    if (Array.isArray(v)) {
      for (const item of v) {
        out.push(...extractFilePaths(item));
      }
    }
  }
  return out;
}

const LOCALHOST_URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s)"'`<]*)?/g;

/** POSIX basename. Substring after the final `/`; if there's no `/`,
 *  returns the input verbatim. Used for the side-tab label so the chip
 *  shows `index.html` instead of the full /Users/.../sess-…/index.html
 *  path. */
function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

/** Pull absolute *.html paths out of an execute tool's rawInput so we
 *  can open them in the side BrowserTab. Two shapes:
 *
 *    - codex execute: `command: ["/bin/zsh","-lc","open /abs/x.html"]`
 *      → look in `command` array for any token matching `*.html` (or
 *      `*.htm`) after stripping argv flags. We also accept the verb
 *      being the whole command string (i.e. command is a single
 *      shell-wrapped string).
 *    - generic file_write / edit of an html file: caller passes
 *      `path` / `file_path` directly. Those go through extractFilePaths
 *      already; we filter to .html here.
 *
 *  Returns absolute paths only — relative paths would have ambiguous
 *  cwd at render-time. Empty when nothing matched. */
function extractHtmlPathsFromExecute(rawInput: unknown): string[] {
  if (!rawInput || typeof rawInput !== "object") return [];
  const obj = rawInput as Record<string, unknown>;
  const out: string[] = [];
  const cmd = obj.command;
  let texts: string[] = [];
  if (typeof cmd === "string") texts = [cmd];
  else if (Array.isArray(cmd))
    texts = cmd.filter((x): x is string => typeof x === "string");
  for (const t of texts) {
    // /(^|\s)(\/[^\s'"]+\.html?)(\s|$)/g — absolute path ending in
    // .html or .htm, surrounded by whitespace or string edge.
    const re = /(^|\s)(\/[^\s'"]+\.html?)(?=\s|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      out.push(m[2]!);
    }
  }
  return out;
}

/** Extract localhost / dev-server URLs from any string-ish piece of
 *  a tool_call payload. Looks at the most likely fields first
 *  (rawOutput, output, stdout) and falls back to JSON-stringifying
 *  the whole object so we don't miss agents that nest output deeper. */
function extractServiceUrls(rawOutput: unknown): string[] {
  if (rawOutput == null) return [];
  let text: string;
  if (typeof rawOutput === "string") {
    text = rawOutput;
  } else if (typeof rawOutput === "object") {
    const obj = rawOutput as Record<string, unknown>;
    const direct = obj.output ?? obj.stdout ?? obj.content;
    if (typeof direct === "string") text = direct;
    else {
      try {
        text = JSON.stringify(rawOutput);
      } catch {
        return [];
      }
    }
  } else {
    return [];
  }
  const matches = text.match(LOCALHOST_URL_RE);
  if (!matches) return [];
  // Strip trailing punctuation that often hugs a URL in shell output
  // ("at http://localhost:3000.", "(http://localhost:5173)").
  return matches.map((u) => u.replace(/[.,)\];]+$/, ""));
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
