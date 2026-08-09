/**
 * Renderer-side session store. Main-session history and task-scoped right-rail
 * workspaces are mirrored to SQLite through the preload API; this class keeps
 * the live materialized view used by React.
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
import type {
  PromptAttachment,
  PromptSessionReference,
  SessionEventOut,
} from "@shared/session-events.js";
import type { BrowserPluginStateEvent } from "@shared/browser-plugin.js";
import { splitAcpSystemNoticeText } from "@shared/acp-system-notices.js";
import {
  createOpenMAEvent,
  reduceWorkItems,
  type OpenMAEvent,
  type WorkItemSnapshot,
} from "@openma/common/session-events/openma";
import { setRightRailCollapsed } from "@/lib/right-rail";
import {
  configOptionFromLegacySessionModes,
  normalizeAgentConfigOptions,
  selectedModeIdFromConfigOptions,
  withSelectedSessionMode,
  type AcpSessionConfigOption,
} from "./session-config-options";
import {
  mergeStreamingText,
  parseAcpEvent,
  reduceTurn,
  sessionUpdateInner,
  sessionUpdateType,
} from "./reduce-turn";
import type {
  NativeAgentContext,
  NativeAgentProvider,
  NativeAgentTranscriptUpdate,
  NativeAgentUpdate,
} from "./native-agent-events";
import {
  genericAcpRuntimeAdapter,
  readSessionGoalUpdateFromAgentAdapter,
  resolveAgentRuntimeAdapter,
  runtimeAdapterForProvider,
  type RuntimeBackgroundWorkItemLevel,
  type RuntimeWorkItemUpdate,
  type SessionGoalUpdateReader,
} from "./agent-runtime-adapters";
import {
  nativeAgentReidentifiedToOpenMAEvent,
  nativeAgentTranscriptToOpenMAEvent,
  nativeAgentUpdateToOpenMAEvent,
  runtimeMonitorEventToOpenMAEvent,
  runtimePlanUpdateToOpenMAEvent,
  runtimeWorkItemUpdateToOpenMAEvents,
} from "@shared/openma-event.js";
import {
  subagentAvatarId,
  type SubagentAvatarId,
} from "./subagent-avatar";
import {
  appendUnique,
  nativeActivitySessionStatus,
  nativeActivityTurnStatus,
  nativeChildThreadId,
} from "./session-native-activity";
import {
  defaultSideTabLabel,
  isPersistedSideTab,
  isPersistedSubagentActivity,
  isSideSessionTab,
  normalizeRestoredSideSession,
  normalizeRestoredTurn,
  normalizeWorkspaceArtifacts,
  subagentActivityLabel,
} from "./session-workspace-normalization";
import {
  basename,
  dedupeBubble,
  dedupeSourceRefs,
  extractCanonicalContentSources,
  extractHtmlPathsFromExecute,
} from "./session-artifacts";
import type {
  AcpAvailableCommand,
  AcpSessionUsage,
  BrokerAsk,
  NativeSubagentMetadata,
  PairRow,
  PairTurnTarget,
  SessionRow,
  SideSessionSnapshot,
  SideTab,
  SideTabType,
  SideWorkspaceStateV1,
  SessionGoal,
  StreamDelta,
  StreamSubscriber,
  SubagentActivity,
  SubagentInheritance,
  TaskBrowserWindow,
  TaskSideWorkspaceSnapshot,
  Turn,
  TurnDeliveryMeta,
  WorkspaceArtifacts,
  WorkspaceSourceRef,
} from "./session-types";

export type { AcpSessionConfigOption } from "./session-config-options";
export type * from "./session-types";

export interface SessionStoreDependencies {
  readSessionGoalUpdate?: SessionGoalUpdateReader;
}

export class SessionStore {
  static readonly NOTICE_DURATION_MS = 10_000;

  #readSessionGoalUpdate: SessionGoalUpdateReader;

  #sessions = new Map<string, SessionRow>();
  /** Blocking broker asks can arrive before session.ready during reload.
   *  Retain them by session id until the matching row is restored. */
  #pendingAsksBeforeSession = new Map<string, BrokerAsk[]>();
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
  /** Provider-normalized outputs and explicit sources per main session.
   *  Runtime adapters own provider tool-name and metadata interpretation;
   *  this store only persists their normalized observations. */
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
  /** Canonical OpenMA event stream received alongside the legacy ACP
   *  transport envelope. This is the migration seam for GUI projections. */
  #openmaEventsBySession = new Map<string, OpenMAEvent[]>();
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
  #noticeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(dependencies: SessionStoreDependencies = {}) {
    this.#readSessionGoalUpdate =
      dependencies.readSessionGoalUpdate ??
      readSessionGoalUpdateFromAgentAdapter;
  }

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
    metadata?: {
      messageId?: string;
      phase?: "commentary" | "final_answer";
    },
  ): void {
    const last = turn.events.at(-1);
    const parsedLast = last ? parseAcpEvent(last.payload) : null;
    const sameMessage =
      parsedLast?.kind === kind &&
      parsedLast.messageId === metadata?.messageId &&
      (kind !== "text" ||
        (parsedLast.kind === "text" &&
          parsedLast.phase === metadata?.phase));
    if (sameMessage) {
      const merged = mergeStreamingText(parsedLast.text, text);
      turn.events[turn.events.length - 1] = {
        payload: {
          sessionUpdate:
            kind === "text" ? "agent_message_chunk" : "agent_thought_chunk",
          ...(metadata?.messageId
            ? { messageId: metadata.messageId }
            : {}),
          ...(metadata?.phase ? { phase: metadata.phase } : {}),
          ...(metadata?.phase
            ? { _meta: { codex: { phase: metadata.phase } } }
            : {}),
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
        ...(metadata?.messageId ? { messageId: metadata.messageId } : {}),
        ...(metadata?.phase ? { phase: metadata.phase } : {}),
        ...(metadata?.phase
          ? { _meta: { codex: { phase: metadata.phase } } }
          : {}),
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

  openmaEventsFor(sessionId: string): OpenMAEvent[] {
    return [...(this.#openmaEventsBySession.get(sessionId) ?? [])];
  }

  workItemsFor(sessionId: string): WorkItemSnapshot[] {
    const events = (this.#openmaEventsBySession.get(sessionId) ?? []).filter(
      // Correlated evidence keeps its work_item_id for inspection and replay,
      // but it is not itself a lifecycle edge. openma-common's generic
      // reducer deliberately merges every correlated event, so keep these
      // evidence-only records out of the GUI WorkItem projection.
      (event) =>
        event.type !== "vendor.event"
        && event.type !== "raw.event"
        && event.type !== "monitor.event",
    );
    return [...reduceWorkItems(events).items.values()];
  }

  #ingestOpenMAEvent(
    event: OpenMAEvent,
    options: { persist?: boolean } = {},
  ): boolean {
    const events = this.#openmaEventsBySession.get(event.session_id) ?? [];
    if (events.some((existing) => existing.event_id === event.event_id)) return false;
    this.#openmaEventsBySession.set(event.session_id, [...events, event]);
    if (options.persist) {
      const persist =
        typeof window !== "undefined"
          ? window.backchat?.sessionPersistCanonicalEvent
          : undefined;
      if (persist) {
        void persist(event).catch((error: unknown) => {
          console.warn("Failed to persist renderer-derived canonical event", error);
        });
      }
    }
    return true;
  }

  #applyCanonicalSessionProjection(event: OpenMAEvent): boolean {
    if (!event.data || typeof event.data !== "object") return false;
    const data = event.data as Record<string, unknown>;
    if (event.type === "session.started") {
      const configOptions =
        normalizeAgentConfigOptions(data.config_options)
        ?? (() => {
          const legacyMode = configOptionFromLegacySessionModes(data.modes);
          return legacyMode ? [legacyMode] : undefined;
        })();
      const capabilities = isPlainRecord(data.capabilities)
        ? data.capabilities
        : {};
      this.#mutateSession(event.session_id, (session) => ({
        ...session,
        acp_session_id:
          typeof data.acp_session_id === "string"
            ? data.acp_session_id
            : session.acp_session_id,
        agent_id:
          typeof data.agent_id === "string"
            ? data.agent_id
            : session.agent_id,
        cwd: typeof data.cwd === "string" ? data.cwd : session.cwd,
        projectId:
          typeof data.project_id === "string"
            ? data.project_id
            : session.projectId,
        additionalDirectories: Array.isArray(data.additional_directories)
          ? data.additional_directories.filter(
              (value): value is string => typeof value === "string",
            )
          : session.additionalDirectories,
        configOptions: configOptions ?? session.configOptions,
        currentModeId:
          selectedModeIdFromConfigOptions(configOptions)
          ?? session.currentModeId,
        supportsSessionFork:
          typeof capabilities.session_fork === "boolean"
            ? capabilities.session_fork
            : session.supportsSessionFork,
        supportsSteering:
          typeof capabilities.steering === "boolean"
            ? capabilities.steering
            : session.supportsSteering,
      }));
      return true;
    }
    if (event.type === "command_catalog.updated") {
      this.#mutateSession(event.session_id, (session) => ({
        ...session,
        availableCommands: Array.isArray(data.commands)
          ? data.commands as AcpAvailableCommand[]
          : [],
      }));
      return true;
    }
    if (event.type === "usage.updated") {
      // Child-correlated usage belongs to the WorkItem registry and native
      // Agent side view, never to the parent session context meter.
      if (event.work_item_id) return true;
      const usage = normalizeSessionUsage(data);
      if (usage) {
        this.#mutateSession(event.session_id, (session) => ({ ...session, usage }));
      }
      return true;
    }
    if (event.type === "system.notice") {
      if (typeof data.message === "string" && data.message.trim()) {
        this.#showNotice(event.session_id, data.message.trim(), "warning");
      }
      return true;
    }
    if (event.type === "session.running") {
      const threadStatus = isPlainRecord(data.thread_status)
        && typeof data.thread_status.type === "string"
          ? data.thread_status.type
          : undefined;
      const providerError = isPlainRecord(data.provider_error)
        ? data.provider_error
        : undefined;
      const providerQueueDepth =
        typeof data.queue_depth === "number"
        && Number.isFinite(data.queue_depth)
        && data.queue_depth >= 0
          ? data.queue_depth
          : undefined;
      this.#mutateSession(event.session_id, (session) => ({
        ...session,
        status: "running",
        agentThreadStatus: threadStatus ?? session.agentThreadStatus,
        providerQueueDepth:
          providerQueueDepth ?? session.providerQueueDepth,
      }));
      if (providerError && typeof providerError.message === "string") {
        this.#showNotice(event.session_id, providerError.message, "warning");
      }
      return true;
    }
    if (event.type === "session.idle") {
      const threadStatus = isPlainRecord(data.thread_status)
        && typeof data.thread_status.type === "string"
          ? data.thread_status.type
          : undefined;
      const providerQueueDepth =
        typeof data.queue_depth === "number"
        && Number.isFinite(data.queue_depth)
        && data.queue_depth >= 0
          ? data.queue_depth
          : undefined;
      this.#mutateSession(event.session_id, (session) => ({
        ...session,
        status: "ready",
        agentThreadStatus: threadStatus ?? session.agentThreadStatus,
        providerQueueDepth:
          providerQueueDepth ?? session.providerQueueDepth,
      }));
      return true;
    }
    if (event.type === "session.terminated") {
      this.#mutateSession(event.session_id, (session) => ({
        ...session,
        status: "disposed",
        activeTurnId: undefined,
      }));
      return true;
    }
    if (event.type === "session.error") {
      const message =
        typeof data.message === "string"
          ? data.message
          : isPlainRecord(data.provider_error)
            && typeof data.provider_error.message === "string"
              ? data.provider_error.message
              : "Agent session failed";
      this.#mutateSession(event.session_id, (session) => ({
        ...session,
        status: "errored",
        lastError: message,
      }));
      return true;
    }
    if (event.type !== "capability.updated") return false;
    if (typeof data.session_archived === "boolean") {
      this.#mutateSession(event.session_id, (session) => ({
        ...session,
        archivedAt: data.session_archived ? Date.now() : undefined,
      }));
      return true;
    }
    const updateType =
      typeof data.sessionUpdate === "string"
        ? data.sessionUpdate
        : typeof data.session_update === "string"
          ? data.session_update
          : undefined;
    if (updateType === "config_option_update") {
      const rawConfigOptions = Array.isArray(data.configOptions)
        ? data.configOptions
        : Array.isArray(data.config_options)
          ? data.config_options
          : undefined;
      const configOptions = normalizeAgentConfigOptions(rawConfigOptions) ?? [];
      this.#mutateSession(event.session_id, (session) => ({
        ...session,
        configOptions,
        currentModeId:
          selectedModeIdFromConfigOptions(configOptions) ?? session.currentModeId,
      }));
      return true;
    }
    if (updateType === "session_info_update") {
      return this.#applyAcpSessionMetadata(
        event.session_id,
        updateType,
        data,
      );
    }
    if (updateType !== "current_mode_update") return false;
    const currentModeId =
      typeof data.currentModeId === "string"
        ? data.currentModeId
        : typeof data.current_mode_id === "string"
          ? data.current_mode_id
          : undefined;
    if (!currentModeId) return false;
    this.#mutateSession(event.session_id, (session) => ({
      ...session,
      currentModeId,
      configOptions: withSelectedSessionMode(
        session.configOptions,
        currentModeId,
      ),
    }));
    return true;
  }

  #canonicalNativeProvider(event: OpenMAEvent): NativeAgentProvider {
    const harness = event.source.harness?.toLowerCase() ?? "";
    if (harness.includes("codex")) return "codex";
    if (harness.includes("opencode")) return "opencode";
    if (harness.includes("kilo")) return "kilo";
    if (harness.includes("cursor")) return "cursor";
    if (harness.includes("pi")) return "pi";
    return "claude";
  }

  #replayCanonicalNativeLifecycle(event: OpenMAEvent): boolean {
    if (!event.work_item_id) return false;
    const data = isPlainRecord(event.data) ? event.data : {};
    const existing = this.subagentByChildId(event.work_item_id);
    const kind = typeof data.kind === "string" ? data.kind : undefined;
    if (event.type === "work_item.reidentified") {
      const previousId =
        typeof data.previous_work_item_id === "string"
          ? data.previous_work_item_id
          : undefined;
      const previous = previousId
        ? this.subagentByChildId(previousId)
        : undefined;
      if (!previous) return false;
      this.#upsertNativeSubagentActivity(event.session_id, {
        provider: previous.native?.provider ?? this.#canonicalNativeProvider(event),
        operation: "subagent_spawn",
        toolCallId: event.parent_id ?? previous.native?.toolCallId,
        childId: event.work_item_id,
        task: previous.task,
        status: previous.status === "draft" ? "running" : previous.status,
      });
      return true;
    }
    if (event.type === "work_item.started") {
      if (kind !== "agent") return false;
      this.#upsertNativeSubagentActivity(event.session_id, {
        provider: this.#canonicalNativeProvider(event),
        operation: "subagent_spawn",
        toolCallId: event.parent_id,
        childId: event.work_item_id,
        task: typeof data.title === "string" ? data.title : undefined,
        status: "running",
      });
      return true;
    }
    if (
      event.type === "work_item.completed"
      || event.type === "work_item.failed"
      || event.type === "work_item.cancelled"
      || event.type === "work_item.killed"
      || event.type === "work_item.terminated"
      || event.type === "work_item.missing_terminal"
    ) {
      if (!existing && kind !== "agent") return false;
      const status =
        event.type === "work_item.completed"
          ? "complete"
          : event.type === "work_item.missing_terminal"
            ? "unknown"
            : event.type === "work_item.cancelled"
              ? "cancelled"
              : event.type === "work_item.failed"
                ? "error"
                : "complete";
      this.#upsertNativeSubagentActivity(event.session_id, {
        provider: this.#canonicalNativeProvider(event),
        operation: "subagent_spawn",
        toolCallId: event.parent_id,
        childId: event.work_item_id,
        status,
        result:
          typeof data.result === "string" ? data.result : undefined,
        errorMessage:
          typeof data.error === "string" ? data.error : undefined,
        reason: typeof data.reason === "string" ? data.reason : undefined,
      });
      return true;
    }
    if (event.type === "usage.updated" && existing) {
      const inputTokens = numberValue(data.input_tokens ?? data.inputTokens);
      const outputTokens = numberValue(data.output_tokens ?? data.outputTokens);
      const totalTokens = numberValue(data.total_tokens ?? data.totalTokens)
        ?? ((inputTokens ?? 0) + (outputTokens ?? 0));
      if (inputTokens === undefined || outputTokens === undefined) return true;
      this.#upsertNativeSubagentActivity(event.session_id, {
        provider: this.#canonicalNativeProvider(event),
        toolCallId: event.parent_id,
        childId: event.work_item_id,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
          ...(numberValue(data.cache_read_input_tokens ?? data.cachedReadTokens) !== undefined
            ? { cachedReadTokens: numberValue(data.cache_read_input_tokens ?? data.cachedReadTokens) }
            : {}),
          ...(numberValue(data.cache_creation_input_tokens ?? data.cachedWriteTokens) !== undefined
            ? { cachedWriteTokens: numberValue(data.cache_creation_input_tokens ?? data.cachedWriteTokens) }
            : {}),
        },
      });
      return true;
    }
    if (event.type === "work_item.progress" && existing) {
      const output = isPlainRecord(data.output) ? data.output : undefined;
      const progressKind =
        output?.kind === "subagent_progress" || output?.kind === "subagent_retry"
          ? output.kind
          : undefined;
      if (!output || !progressKind) return true;
      const rawUsage = isPlainRecord(output.usage) ? output.usage : undefined;
      const totalTokens = numberValue(rawUsage?.totalTokens ?? rawUsage?.total_tokens);
      const toolUses = numberValue(rawUsage?.toolUses ?? rawUsage?.tool_uses);
      const durationMs = numberValue(rawUsage?.durationMs ?? rawUsage?.duration_ms);
      this.#upsertNativeSubagentActivity(event.session_id, {
        provider: this.#canonicalNativeProvider(event),
        toolCallId: event.parent_id,
        childId: event.work_item_id,
        progress: {
          kind: progressKind,
          ...(numberValue(output.elapsedTimeSeconds) !== undefined
            ? { elapsedTimeSeconds: numberValue(output.elapsedTimeSeconds) }
            : {}),
          ...(typeof output.subagentType === "string"
            ? { subagentType: output.subagentType }
            : {}),
          ...(typeof output.description === "string"
            ? { description: output.description }
            : {}),
          ...(typeof output.lastToolName === "string"
            ? { lastToolName: output.lastToolName }
            : {}),
          ...(typeof output.summary === "string" ? { summary: output.summary } : {}),
          ...(totalTokens !== undefined
            && toolUses !== undefined
            && durationMs !== undefined
            ? { usage: { totalTokens, toolUses, durationMs } }
            : {}),
          ...(isPlainRecord(output.retry) ? { retry: output.retry } : {}),
        },
      });
      return true;
    }
    return false;
  }

  #replayCanonicalNativeTranscript(event: OpenMAEvent, receivedAt: number): boolean {
    if (!event.work_item_id || !event.parent_id) return false;
    if (
      event.type !== "agent.message"
      && event.type !== "agent.message_chunk"
      && event.type !== "agent.thinking"
      && event.type !== "tool.started"
      && event.type !== "tool.progress"
      && event.type !== "tool.completed"
      && event.type !== "tool.failed"
      && event.type !== "tool.cancelled"
    ) return false;

    let activity = this.subagentByChildId(event.work_item_id);
    if (!activity) {
      this.#upsertNativeSubagentActivity(event.session_id, {
        provider: this.#canonicalNativeProvider(event),
        operation: "subagent_spawn",
        toolCallId: event.parent_id,
        childId: event.work_item_id,
        status: "running",
      });
      activity = this.subagentByChildId(event.work_item_id);
    }
    if (!activity) return true;
    const childTurnId = `${activity.viewSessionId}:turn`;
    const previous = this.#turns.get(childTurnId);
    const turn: Turn = previous ?? {
      id: childTurnId,
      sessionId: activity.viewSessionId,
      promptText: activity.task,
      events: [],
      assistantText: "",
      thoughtText: "",
      status: "running",
      startedAt: receivedAt,
    };
    const parsed = parseAcpEvent(event);
    if (parsed.kind === "text") {
      turn.assistantText = mergeStreamingText(turn.assistantText, parsed.text);
      this.#appendStreamEvent(turn, "text", parsed.text, receivedAt, {
        messageId: parsed.messageId,
        phase: parsed.phase,
      });
    } else if (parsed.kind === "thought") {
      turn.thoughtText = mergeStreamingText(turn.thoughtText, parsed.text);
      this.#appendStreamEvent(turn, "thought", parsed.text, receivedAt, {
        messageId: parsed.messageId,
      });
    } else {
      turn.events.push({ payload: event, receivedAt });
    }
    this.#turns.set(childTurnId, { ...turn, events: [...turn.events] });
    return true;
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
    const normalizedCwd = cwd?.trim() || undefined;
    this.#mutateSession(id, (s) => ({
      ...s,
      chosenCwd: normalizedCwd,
      projectScope: normalizedCwd ? "project" : "none",
      projectId: undefined,
      additionalDirectories: undefined,
    }));
    this.#emit();
  }

  /** Push a new broker ask onto a session's pending queue. */
  enqueueAsk(sessionId: string, ask: BrokerAsk): void {
    const row = this.#sessions.get(sessionId);
    if (!row) {
      const pending = this.#pendingAsksBeforeSession.get(sessionId) ?? [];
      if (!pending.some((candidate) => candidate.ask.requestId === ask.ask.requestId)) {
        this.#pendingAsksBeforeSession.set(sessionId, [...pending, ask]);
      }
      return;
    }
    const pending = row.pendingAsks ?? [];
    if (pending.some((candidate) => candidate.ask.requestId === ask.ask.requestId)) {
      return;
    }
    this.#mutateSession(sessionId, (s) => ({
      ...s,
      pendingAsks: [...pending, ask],
    }));
    this.#emit();
  }

  /** Remove an ask by its request id — called after the user picks an
   *  option (or the ask gets superseded by a cancel). */
  dequeueAsk(sessionId: string, requestId: string): void {
    const row = this.#sessions.get(sessionId);
    if (!row) {
      const pending = this.#pendingAsksBeforeSession.get(sessionId);
      if (!pending) return;
      const next = pending.filter((ask) => ask.ask.requestId !== requestId);
      if (next.length > 0) this.#pendingAsksBeforeSession.set(sessionId, next);
      else this.#pendingAsksBeforeSession.delete(sessionId);
      return;
    }
    if (!row.pendingAsks?.length) return;
    const next = row.pendingAsks.filter((a) => a.ask.requestId !== requestId);
    this.#mutateSession(sessionId, (s) => ({
      ...s,
      pendingAsks: next.length ? next : undefined,
    }));
    this.#emit();
  }

  dismissNotice(sessionId: string, noticeId?: string): void {
    const row = this.#sessions.get(sessionId);
    if (!row?.notice || (noticeId && row.notice.id !== noticeId)) return;
    const timer = this.#noticeTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.#noticeTimers.delete(sessionId);
    this.#mutateSession(sessionId, (session) => ({
      ...session,
      notice: undefined,
    }));
    this.#emit();
  }

  #showNotice(
    sessionId: string,
    message: string,
    tone: "warning",
  ): void {
    const row = this.#sessions.get(sessionId);
    if (!row) return;
    const previousTimer = this.#noticeTimers.get(sessionId);
    if (previousTimer) clearTimeout(previousTimer);

    const now = Date.now();
    const notice = {
      id: `${sessionId}:${now}`,
      message,
      tone,
      expiresAt: now + SessionStore.NOTICE_DURATION_MS,
    } as const;
    this.#mutateSession(sessionId, (session) => ({ ...session, notice }));
    const timer = setTimeout(() => {
      this.dismissNotice(sessionId, notice.id);
    }, SessionStore.NOTICE_DURATION_MS);
    this.#noticeTimers.set(sessionId, timer);
  }

  // -------- Pin / archive --------

  /** Rename a user-facing session and persist the explicit override. */
  async rename(sessionId: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;
    await window.backchat.sessionsRename({
      session_id: sessionId,
      title: trimmed,
    });
    this.#mutateSession(sessionId, (s) => ({
      ...s,
      label: trimmed.slice(0, 500),
      titleManuallySet: true,
    }));
    this.#emit();
  }

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

  /** Serialize every non-empty task rail into a versioned, JSON-safe shape.
   *  Runtime handles are normalized: terminal ids are discarded in favor of
   *  cwd, while in-flight side turns become interrupted rather than claiming
   *  they are still attached to a process after restart. */
  sideWorkspaceSnapshots(): TaskSideWorkspaceSnapshot[] {
    const taskIds = new Set<string>();
    for (const taskId of this.#sideTabsByMain.keys()) {
      if (taskId) taskIds.add(taskId);
    }
    for (const taskId of this.#artifactsBySession.keys()) taskIds.add(taskId);
    for (const taskId of this.#subagentsByParent.keys()) taskIds.add(taskId);

    return [...taskIds].sort().flatMap((taskId) => {
      // MCP App views are reconstructed from the owning tool call. Persisting
      // the empty rail shell would restore a dead tab before chat history has
      // recreated its AppBridge.
      const sourceTabs = (this.#sideTabsByMain.get(taskId) ?? [])
        .filter((tab) =>
          tab.type !== "interactive" &&
          tab.type !== "process" &&
          tab.source?.kind !== "browser-plugin"
        );
      const artifacts = this.#artifactsBySession.get(taskId) ?? {
        files: [],
        services: [],
        sources: [],
      };
      const subagents = this.#subagentsByParent.get(taskId) ?? [];
      if (sourceTabs.length === 0 && artifacts.files.length === 0 && artifacts.services.length === 0 && artifacts.sources.length === 0 && subagents.length === 0) {
        return [];
      }

      const parent = this.#sessions.get(taskId);
      const tabs = sourceTabs.map((tab): SideTab =>
        tab.type === "terminal"
          ? {
              ...tab,
              payload: "",
              terminalCwd: tab.terminalCwd || parent?.cwd || "",
              needsRestore: true,
            }
          : { ...tab },
      );
      const sideSessionIds = new Set(
        tabs.filter((tab) => isSideSessionTab(tab.type)).map((tab) => tab.payload),
      );
      const sideSessions = [...sideSessionIds].flatMap((sessionId) => {
        const row = this.#sessions.get(sessionId);
        if (!row || row.kind !== "side") return [];
        return [{
          row: { ...row, pendingAsks: undefined },
          turns: this.turnsFor(sessionId).map((turn) => ({
            ...turn,
            events: turn.events.map((event) => ({ ...event })),
          })),
        }];
      });

      return [{
        taskId,
        state: {
          version: 1,
          tabs,
          activeTabId: this.#activeSideTabByMain.get(taskId) ?? null,
          activeBrowserTabId: this.#activeBrowserTabByMain.get(taskId) ?? null,
          artifacts: {
            files: [...artifacts.files],
            services: [...artifacts.services],
            sources: artifacts.sources.map((source) => ({ ...source })),
          },
          sideSessions,
          subagents: subagents.map((activity) => ({
            ...activity,
            native: activity.native ? { ...activity.native } : undefined,
          })),
        },
      }];
    });
  }

  /** Restore validated task workspace snapshots before the first chat route
   *  paints. This replaces only right-rail-owned state; main session rows
   *  seeded from SQLite remain authoritative. */
  hydrateSideWorkspaces(snapshots: TaskSideWorkspaceSnapshot[]): void {
    let changed = false;
    for (const snapshot of snapshots) {
      const { taskId, state } = snapshot;
      if (!taskId || state?.version !== 1 || !Array.isArray(state.tabs)) continue;

      const tabs = state.tabs
        .filter(isPersistedSideTab)
        .map((tab): SideTab =>
          tab.type === "terminal"
            ? {
                ...tab,
                payload: "",
                terminalCwd: tab.terminalCwd || this.#sessions.get(taskId)?.cwd || "",
                needsRestore: true,
              }
            : { ...tab, needsRestore: undefined },
        );
      if (tabs.length > 0) this.#sideTabsByMain.set(taskId, tabs);
      else this.#sideTabsByMain.delete(taskId);

      const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
        ? state.activeTabId
        : tabs.at(-1)?.id ?? null;
      if (activeTabId) this.#activeSideTabByMain.set(taskId, activeTabId);
      else this.#activeSideTabByMain.delete(taskId);

      const browserTabs = tabs.filter((tab) => tab.type === "browser");
      const activeBrowserTabId = browserTabs.some(
        (tab) => tab.id === state.activeBrowserTabId,
      )
        ? state.activeBrowserTabId
        : browserTabs[0]?.id ?? null;
      if (activeBrowserTabId) {
        this.#activeBrowserTabByMain.set(taskId, activeBrowserTabId);
      } else {
        this.#activeBrowserTabByMain.delete(taskId);
      }

      const artifacts = normalizeWorkspaceArtifacts(state.artifacts);
      if (artifacts.files.length > 0 || artifacts.services.length > 0 || artifacts.sources.length > 0) {
        this.#artifactsBySession.set(taskId, artifacts);
      }
      const autoOpened = new Set(
        tabs
          .filter((tab) => tab.type === "browser" && tab.payload.startsWith("file://"))
          .map((tab) => tab.payload.slice("file://".length)),
      );
      if (autoOpened.size > 0) this.#autoOpenedHtmlBySession.set(taskId, autoOpened);

      if (Array.isArray(state.sideSessions)) {
        for (const item of state.sideSessions) {
          if (!item?.row?.id || item.row.kind !== "side") continue;
          const row = normalizeRestoredSideSession(item.row);
          this.#sessions.set(row.id, row);
          for (const rawTurn of Array.isArray(item.turns) ? item.turns : []) {
            if (!rawTurn?.id || rawTurn.sessionId !== row.id) continue;
            const turn = normalizeRestoredTurn(rawTurn);
            this.#turns.set(turn.id, turn);
          }
        }
      }
      if (Array.isArray(state.subagents) && state.subagents.length > 0) {
        this.#subagentsByParent.set(
          taskId,
          state.subagents.filter(isPersistedSubagentActivity).map((activity) => ({
            ...activity,
            native: activity.native ? { ...activity.native } : undefined,
          })),
        );
      }
      changed = true;
    }
    this.#syncVisibleSideSession(this.#sideBucket());
    if (changed) this.#emit();
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
    avatarId?: SubagentAvatarId,
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
        avatarId: avatarId ?? existing.avatarId,
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
      avatarId,
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

  /** Mirror visible in-app Browser plugin state into the active task's rail.
   *  The main-process Browser service remains the source of truth; projected
   *  tabs are intentionally excluded from persisted workspace snapshots. */
  syncBrowserPluginState(event: BrowserPluginStateEvent): void {
    if (event.browser.type !== "iab") return;

    const bucket = this.#sideBucket();
    if (!bucket) return;
    const tabs = this.#sideTabsByMain.get(bucket) ?? [];
    const isControlledForBrowser = (tab: SideTab) =>
      tab.source?.kind === "browser-plugin" &&
      tab.source.browserId === event.browser.id;

    if (!event.visible) {
      const nextTabs = tabs.filter((tab) => !isControlledForBrowser(tab));
      if (nextTabs.length === tabs.length) return;
      if (nextTabs.length === 0) this.#sideTabsByMain.delete(bucket);
      else this.#sideTabsByMain.set(bucket, nextTabs);

      const activeSideTabId = this.#activeSideTabByMain.get(bucket);
      if (!nextTabs.some((tab) => tab.id === activeSideTabId)) {
        const next = nextTabs.at(-1);
        if (next) this.#activeSideTabByMain.set(bucket, next.id);
        else this.#activeSideTabByMain.delete(bucket);
      }
      const activeBrowserTabId = this.#activeBrowserTabByMain.get(bucket);
      if (!nextTabs.some((tab) => tab.id === activeBrowserTabId)) {
        const nextBrowser = [...nextTabs]
          .reverse()
          .find((tab) => tab.type === "browser");
        if (nextBrowser) this.#activeBrowserTabByMain.set(bucket, nextBrowser.id);
        else this.#activeBrowserTabByMain.delete(bucket);
      }
      this.#syncVisibleSideSession(bucket);
      this.#emit();
      return;
    }

    const projected = event.tabs.map((browserTab) => {
      const url = browserTab.url || "about:blank";
      const existing = tabs.find(
        (tab) =>
          tab.source?.kind === "browser-plugin" &&
          tab.source.browserId === event.browser.id &&
          tab.source.tabId === browserTab.id,
      );
      return {
        id: existing?.id ?? `tab-browser-${event.browser.id}-${browserTab.id}`,
        type: "browser" as const,
        label: defaultSideTabLabel("browser", url),
        payload: url,
        source: {
          kind: "browser-plugin" as const,
          browserId: event.browser.id,
          tabId: browserTab.id,
        },
        createdAt: existing?.createdAt ?? Date.now(),
      };
    });

    this.#sideTabsByMain.set(bucket, [
      ...tabs.filter((tab) => !isControlledForBrowser(tab)),
      ...projected,
    ]);

    const activeProjection =
      (event.activeTabId
        ? projected.find((tab) => tab.source.tabId === event.activeTabId)
        : undefined) ?? projected.at(-1);
    if (activeProjection) {
      this.#activeSideTabByMain.set(bucket, activeProjection.id);
      this.#activeBrowserTabByMain.set(bucket, activeProjection.id);
      this.#syncVisibleSideSession(bucket);
      setRightRailCollapsed(false);
    }

    this.#emit();
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

  // -------- Normalized workspace resources --------

  artifactsFor(sessionId: string): WorkspaceArtifacts {
    return this.#artifactsBySession.get(sessionId) ?? {
      files: [],
      services: [],
      sources: [],
    };
  }

  /** Merge provider-normalized outputs and sources into the session index.
   *  Newest-first ordering; re-observed entries bubble to the top. */
  #ingestArtifacts(
    sessionId: string,
    files: string[],
    services: string[],
    sources: WorkspaceSourceRef[] = [],
  ): void {
    if (files.length === 0 && services.length === 0 && sources.length === 0) return;
    const prev = this.#artifactsBySession.get(sessionId) ?? {
      files: [],
      services: [],
      sources: [],
    };
    const nextFiles = files.length > 0 ? dedupeBubble(prev.files, files, 50) : prev.files;
    const nextServices =
      services.length > 0 ? dedupeBubble(prev.services, services, 50) : prev.services;
    const nextSources =
      sources.length > 0 ? dedupeSourceRefs(prev.sources, sources, 50) : prev.sources;
    if (
      nextFiles === prev.files
      && nextServices === prev.services
      && nextSources === prev.sources
    ) return;
    this.#artifactsBySession.set(sessionId, {
      files: nextFiles,
      services: nextServices,
      sources: nextSources,
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
  newDraft(
    chosenCwd?: string | {
      projectId: string;
      sourceFolders: string[];
    },
  ): string {
    for (const [existingId, session] of this.#sessions) {
      if (session.status === "draft" && session.kind !== "side") {
        this.#sessions.delete(existingId);
      }
    }
    const id = `sess-${Math.random().toString(36).slice(2, 10)}`;
    const project =
      typeof chosenCwd === "object" && chosenCwd !== null
        ? chosenCwd
        : undefined;
    const roots = project
      ? [...new Set(
          project.sourceFolders.map((folder) => folder.trim()).filter(Boolean),
        )]
      : [];
    const normalizedCwd =
      typeof chosenCwd === "string"
        ? chosenCwd.trim() || undefined
        : roots[0] || undefined;
    this.#sessions.set(id, {
      id,
      agent_id: "",
      cwd: "",
      acp_session_id: "",
      label: "",
      status: "draft",
      createdAt: Date.now(),
      chosenCwd: normalizedCwd,
      projectId: project?.projectId.trim() || undefined,
      additionalDirectories: roots.length > 1 ? roots.slice(1) : undefined,
      projectScope: project || normalizedCwd ? "project" : "none",
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
    const parent = opts?.parentSessionId
      ? this.#sessions.get(opts.parentSessionId)
      : undefined;
    this.#sessions.set(id, {
      id,
      agent_id: opts?.agentId ?? parent?.agent_id ?? "",
      cwd: opts?.cwd ?? parent?.cwd ?? "",
      acp_session_id: "",
      label: "",
      kind: "side",
      sideKind: "chat",
      status: "draft",
      createdAt: Date.now(),
      projectId: parent?.projectId,
      additionalDirectories: parent?.additionalDirectories
        ? [...parent.additionalDirectories]
        : undefined,
      projectScope: parent?.projectScope,
      configOptions: parent?.configOptions?.map((option) => ({ ...option })),
      currentModeId: parent?.currentModeId,
      availableCommands: parent?.availableCommands?.map((command) => ({
        ...command,
      })),
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

  /** Create an independent main-chat draft that will inherit the current
   *  ACP context on its first prompt. The provider session is intentionally
   *  started lazily, matching ordinary drafts and avoiding an idle child
   *  process when the user changes their mind. */
  newMainForkDraft(parentSessionId: string): string | null {
    const parent = this.#sessions.get(parentSessionId);
    if (
      !parent
      || parent.status === "draft"
      || parent.sideKind === "subagent"
      || !parent.supportsSessionFork
      || !parent.acp_session_id
    ) {
      return null;
    }
    const id = `fork-${Math.random().toString(36).slice(2, 10)}`;
    this.#sessions.set(id, {
      id,
      agent_id: parent.agent_id,
      cwd: parent.cwd,
      acp_session_id: "",
      label: "",
      kind: "main",
      status: "draft",
      createdAt: Date.now(),
      projectId: parent.projectId,
      additionalDirectories: parent.additionalDirectories
        ? [...parent.additionalDirectories]
        : undefined,
      projectScope: parent.projectScope,
      configOptions: parent.configOptions?.map((option) => ({ ...option })),
      currentModeId: parent.currentModeId,
      availableCommands: parent.availableCommands?.map((command) => ({
        ...command,
      })),
      forkParent: {
        parentSessionId: parent.id,
        parentAcpSessionId: parent.acp_session_id,
        inheritance: "fork",
      },
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
    const pendingAsks = this.#pendingAsksBeforeSession.get(id);
    this.#pendingAsksBeforeSession.delete(id);
    this.#sessions.set(id, {
      id,
      agent_id,
      cwd: "",
      acp_session_id: "",
      label,
      status: "starting",
      createdAt: Date.now(),
      pendingAsks,
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
    sessionReferences: PromptSessionReference[] = [],
    attachments: PromptAttachment[] = [],
  ): void {
    const row = this.#sessions.get(sessionId);
    const isQueued = !!row?.activeTurnId;
    this.#turns.set(turnId, {
      id: turnId,
      sessionId,
      promptText,
      attachments: attachments.length > 0
        ? attachments.map(({ data: _data, ...attachment }) => attachment)
        : undefined,
      sessionReferences: sessionReferences.length > 0
        ? sessionReferences
        : undefined,
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
          pendingAsks: undefined,
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

  #applyAcpSessionMetadata(
    sessionId: string,
    updateType: string | undefined,
    inner: Record<string, unknown>,
  ): boolean {
    if (updateType === "usage_update") {
      const usage = normalizeSessionUsage(inner);
      if (usage) {
        this.#mutateSession(sessionId, (s) => ({ ...s, usage }));
      }
      return true;
    }
    if (updateType !== "session_info_update") return false;

    this.#mutateSession(sessionId, (s) => {
      const nextMeta = isPlainRecord(inner._meta)
        ? deepMergeRecords(s.sessionInfoMeta ?? {}, inner._meta)
        : s.sessionInfoMeta;
      const adapter =
        resolveAgentRuntimeAdapter(s.agent_id) ?? genericAcpRuntimeAdapter;
      const threadStatus = adapter.sessionThreadStatusUpdate({
        update: inner,
        meta: nextMeta,
      });
      const goal = activeSessionGoalUpdate(
        this.#readSessionGoalUpdate({
          agentId: s.agent_id,
          update: inner,
          meta: nextMeta,
        }),
      );
      return {
        ...s,
        label:
          !s.titleManuallySet && typeof inner.title === "string" && inner.title.trim()
            ? inner.title.trim().slice(0, 500)
            : s.label,
        sessionUpdatedAt:
          typeof inner.updatedAt === "string"
            ? inner.updatedAt
            : s.sessionUpdatedAt,
        sessionInfoMeta: nextMeta,
        agentThreadStatus: threadStatus ?? s.agentThreadStatus,
        ...(goal === undefined
          ? {}
          : goal === null
            ? { goal: undefined }
            : { goal }),
      };
    });
    return true;
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
      avatarId: prev?.avatarId ?? subagentAvatarId(childSessionId),
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
    logicalTool?: { toolCallId: string; parentToolUseId?: string },
    turnId?: string,
  ): void {
    const adapter = resolveAgentRuntimeAdapter(
      this.#sessions.get(parentSessionId)?.agent_id,
    );
    if (!adapter) return;
    const context =
      this.#nativeAgentContextByToolCall.get(tool.toolCallId) ??
      (tool.parentToolUseId
        ? this.#nativeAgentContextByToolCall.get(tool.parentToolUseId)
        : undefined);
    const sameParentContext =
      context?.parentSessionId === parentSessionId ? context : undefined;
    this.#ingestNativeAgentUpdates(
      parentSessionId,
      adapter.nativeAgentToolUpdates(tool, sameParentContext, logicalTool),
      { turnId },
    );
  }

  #ingestNativeAgentUpdates(
    parentSessionId: string,
    updates: NativeAgentUpdate[],
    options: { turnId?: string; emitCanonical?: boolean } = {},
  ): void {
    for (const update of updates) {
      const previousContext = update.toolCallId
        ? this.#nativeAgentContextByToolCall.get(update.toolCallId)
        : undefined;
      if (options.emitCanonical !== false) {
        const occurredAt = new Date().toISOString();
        if (
          previousContext?.parentSessionId === parentSessionId
          && update.childId
          && previousContext.childId !== update.childId
        ) {
          this.#ingestOpenMAEvent(nativeAgentReidentifiedToOpenMAEvent({
            provider: update.provider,
            previousChildId: previousContext.childId,
            childId: update.childId,
            toolCallId: update.toolCallId,
          }, {
            sessionId: parentSessionId,
            ...(options.turnId ? { turnId: options.turnId } : {}),
            occurredAt,
            adapter: update.provider,
          }), { persist: true });
        }
        const event = nativeAgentUpdateToOpenMAEvent(update, {
          sessionId: parentSessionId,
          ...(options.turnId ? { turnId: options.turnId } : {}),
          occurredAt,
          adapter: update.provider,
        });
        if (event) this.#ingestOpenMAEvent(event, { persist: true });
      }
      this.#upsertNativeSubagentActivity(parentSessionId, update);
    }
  }

  #ingestNativeAgentTranscript(
    parentSessionId: string,
    updates: NativeAgentTranscriptUpdate[],
    turnId?: string,
  ): void {
    for (const update of updates) {
      const context = this.#nativeAgentContextByToolCall.get(
        update.parentToolUseId,
      );
      const childId =
        context?.childId ?? `${update.provider}:${update.parentToolUseId}`;
      const lifecycle: NativeAgentUpdate = {
        provider: update.provider,
        operation: "claude_agent",
        toolCallId: update.parentToolUseId,
        childId,
        status: "running",
        ...(update.usage ? { usage: update.usage } : {}),
        ...(update.kind === "tool" && update.toolCallId
          ? {
              childToolCallId: update.toolCallId,
              childToolName: update.toolName,
            }
          : {}),
      };
      const transcriptEvent = nativeAgentTranscriptToOpenMAEvent(update, {
        sessionId: parentSessionId,
        ...(turnId ? { turnId } : {}),
        childId,
        occurredAt: new Date().toISOString(),
        adapter: update.provider,
      });
      if (transcriptEvent) {
        this.#ingestOpenMAEvent(transcriptEvent, { persist: true });
      }
      this.#ingestNativeAgentUpdates(parentSessionId, [lifecycle], {
        turnId,
      });

      const activity = (this.#subagentsByParent.get(parentSessionId) ?? []).find(
        (candidate) =>
          candidate.childSessionId === childId ||
          candidate.native?.toolCallId === update.parentToolUseId,
      );
      if (!activity) continue;

      const childTurnId = `${activity.viewSessionId}:turn`;
      const previous = this.#turns.get(childTurnId);
      const now = Date.now();
      const next: Turn = previous ?? {
        id: childTurnId,
        sessionId: activity.viewSessionId,
        promptText: activity.task,
        events: [],
        assistantText: "",
        thoughtText: "",
        status: "running",
        startedAt: now,
      };
      next.status = "running";
      next.endedAt = undefined;
      if (update.kind === "text" && update.text) {
        next.assistantText = mergeStreamingText(next.assistantText, update.text);
        this.#appendStreamEvent(next, "text", update.text, now, {
          messageId: update.messageId,
        });
      } else if (update.kind === "thought" && update.text) {
        next.thoughtText = mergeStreamingText(next.thoughtText, update.text);
        this.#appendStreamEvent(next, "thought", update.text, now, {
          messageId: update.messageId,
        });
      } else if (update.kind === "tool") {
        next.events = [
          ...next.events,
          { payload: update.payload, receivedAt: now },
        ];
      } else if (update.kind === "content" && transcriptEvent) {
        next.events = [
          ...next.events,
          { payload: transcriptEvent, receivedAt: now },
        ];
      }
      this.#turns.set(childTurnId, {
        ...next,
        events: [...next.events],
      });
      this.#syncNativeSubagentView(parentSessionId, activity);
    }
  }

  #settleNativeSubagentsForTurn(parentSessionId: string, turn: Turn): void {
    const toolCallIds = new Set(
      turn.events.flatMap(({ payload }) => {
        const parsed = parseAcpEvent(payload);
        return parsed.kind === "tool_call" ? [parsed.tool.toolCallId] : [];
      }),
    );
    const linked = (this.#subagentsByParent.get(parentSessionId) ?? []).filter(
      (activity) =>
        activity.status === "running" &&
        activity.native !== undefined &&
        runtimeAdapterForProvider(activity.native.provider)
          ?.settleNativeAgentOnParentTurnComplete !== false &&
        activity.native.toolCallId !== undefined &&
        toolCallIds.has(activity.native.toolCallId),
    );
    for (const activity of linked) {
      const provider = activity.native!.provider;
      const policy = runtimeAdapterForProvider(provider)
        ?.settleNativeAgentOnParentTurnComplete;
      if (policy === "missing_terminal") {
        this.#ingestNativeAgentUpdates(parentSessionId, [{
          provider,
          toolCallId: activity.native!.toolCallId,
          childId: activity.childSessionId,
          status: "unknown",
        }], { turnId: turn.id });
      } else {
        this.#ingestNativeAgentUpdates(parentSessionId, [{
          provider,
          toolCallId: activity.native!.toolCallId,
          childId: activity.childSessionId,
          status: "complete",
        }], { turnId: turn.id });
      }
    }
  }

  #settleBackgroundWorkItemsForTurn(sessionId: string, turn: Turn): void {    const toolCallIds = new Set(
      turn.events.flatMap(({ payload }) => {
        const parsed = parseAcpEvent(payload);
        return parsed.kind === "tool_call" ? [parsed.tool.toolCallId] : [];
      }),
    );
    const events = this.#openmaEventsBySession.get(sessionId) ?? [];
    const items = reduceWorkItems(events).items;
    const runningBashStarts = events.filter((event) => {
      if (
        event.type !== "work_item.started"
        || event.turn_id !== turn.id
        || !event.work_item_id
        || !event.parent_id
        || !toolCallIds.has(event.parent_id)
      ) {
        return false;
      }
      const data = isPlainRecord(event.data) ? event.data : {};
      return data.kind === "bash";
    });

    for (const started of runningBashStarts) {
      const workItemId = started.work_item_id!;
      if (items.get(workItemId)?.status !== "running") continue;
      this.#ingestOpenMAEvent(createOpenMAEvent({
        event_id: `runtime-work-item-missing-terminal:${sessionId}:${turn.id}:${workItemId}`,
        session_id: sessionId,
        turn_id: turn.id,
        work_item_id: workItemId,
        parent_id: started.parent_id,
        source: started.source,
        occurred_at: new Date().toISOString(),
        type: "work_item.missing_terminal",
        data: {
          missing_terminal: true,
          reason: "parent_turn_completed",
        },
      }), { persist: true });
    }
  }

  #reconcileBackgroundWorkItemLevel(
    sessionId: string,
    turnId: string,
    adapter: string,
    level: RuntimeBackgroundWorkItemLevel,
  ): void {
    const liveTaskIds = new Set(level.liveTaskIds);
    const existingById = new Map(
      this.workItemsFor(sessionId).map((item) => [item.id, item]),
    );
    for (const update of level.liveWorkItems) {
      const existing = existingById.get(update.id);
      if (existing && existing.status !== "unknown") continue;
      this.#ingestOpenMAEvent(createOpenMAEvent({
        event_id: `runtime-background-level-live:${sessionId}:${level.eventId}:${update.id}`,
        session_id: sessionId,
        ...(turnId ? { turn_id: turnId } : {}),
        work_item_id: update.id,
        source: { kind: "harness", harness: adapter, adapter },
        occurred_at: new Date().toISOString(),
        type: "work_item.started",
        data: {
          kind: update.kind,
          missing_terminal: false,
          ...(update.title ? { title: update.title } : {}),
          ...(update.canStop !== undefined ? { can_stop: update.canStop } : {}),
        },
      }), { persist: true });
    }
    for (const item of this.workItemsFor(sessionId)) {
      if (
        item.kind === "agent"
        || item.status !== "running"
        || liveTaskIds.has(item.id)
      ) {
        continue;
      }
      this.#ingestOpenMAEvent(createOpenMAEvent({
        event_id: `runtime-background-level-missing:${sessionId}:${level.eventId}:${item.id}`,
        session_id: sessionId,
        ...(turnId ? { turn_id: turnId } : {}),
        work_item_id: item.id,
        source: { kind: "harness", harness: adapter, adapter },
        occurred_at: new Date().toISOString(),
        type: "work_item.missing_terminal",
        data: {
          missing_terminal: true,
          reason: "absent_from_background_level",
        },
      }), { persist: true });
    }
  }

  #ingestRuntimeWorkItemUpdate(
    sessionId: string,
    turnId: string,
    adapter: string,
    update: RuntimeWorkItemUpdate,
  ): void {
    const existing = this.workItemsFor(sessionId).find(
      (item) => item.id === update.id,
    );
    // A classification refines an already-observed lifecycle; it must not
    // manufacture a subscription from a delivery-only monitor event.
    if (update.phase === "classification" && !existing) return;
    // Claude's terminal task_notification carries a stable task_id but no
    // task kind. Preserve the kind established by an earlier structured
    // lifecycle edge; do not classify an uncorrelated terminal notification.
    const correlated =
      update.kind === "other"
      && existing
      && (
        existing.kind === "agent"
        || existing.kind === "bash"
        || existing.kind === "monitor"
      )
        ? { ...update, kind: existing.kind }
        : update;
    for (const event of runtimeWorkItemUpdateToOpenMAEvents(correlated, {
      sessionId,
      turnId,
      occurredAt: new Date().toISOString(),
      adapter,
    })) {
      this.#ingestOpenMAEvent(event, { persist: true });
      if (correlated.kind === "agent") {
        this.#replayCanonicalNativeLifecycle(event);
      }
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
      progress: update.progress ?? prev?.native?.progress,
      usage: update.usage ?? prev?.native?.usage,
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
      avatarId: prev?.avatarId ?? subagentAvatarId(childSessionId),
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
        task: update.task ?? prev?.task,
        agentType: update.agentType ?? prev?.native?.agentType,
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
      subagentAvatarId: activity.avatarId,
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
        previousTurn?.assistantText || activity.native?.result || "",
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
        undefined,
        activity.avatarId,
      );
      return;
    }

    const tab = withoutLegacy[tabIndex]!;
    if (
      tab.label !== label ||
      tab.avatarId !== activity.avatarId ||
      withoutLegacy.length !== tabs.length
    ) {
      this.#sideTabsByMain.set(parentSessionId, [
        ...withoutLegacy.slice(0, tabIndex),
        { ...tab, label, avatarId: activity.avatarId },
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
        pinnedAt: r.pinned_at ?? undefined,
        archivedAt: r.archived_at ?? undefined,
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
      title_manually_set?: number;
      last_used_at: number;
      created_at: number;
      pinned_at?: number | null;
      archived_at?: number | null;
      project_id?: string | null;
      additional_directories?: string[];
    }>,
  ): void {
    for (const r of rows) {
      // A row without a title has never received a prompt. Older builds
      // persisted these pre-start shells and revived them as duplicate
      // "New chat" rows on every launch. Drafts are renderer-owned and
      // intentionally ephemeral, so there is nothing useful to restore.
      if (!r.title.trim() && !this.#isPairMember(r.id)) continue;
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
          projectId: r.project_id ?? s.projectId,
          additionalDirectories:
            r.additional_directories ?? s.additionalDirectories,
          acp_session_id: r.acp_session_id || s.acp_session_id,
          label: r.title || s.label,
          titleManuallySet: r.title_manually_set === 1 || s.titleManuallySet,
          projectScope: s.projectScope,
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
        projectId: r.project_id ?? undefined,
        additionalDirectories: r.additional_directories,
        acp_session_id: r.acp_session_id,
        label: r.title || "New chat",
        titleManuallySet: r.title_manually_set === 1,
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

    // New rows contain the canonical envelope as the fact source. The
    // envelope's `raw` field is compatibility evidence, not a second event
    // to replay. Pre-scan it so a mixed history from the migration window can
    // skip a legacy raw row even when that row appears before its canonical
    // counterpart in SQL order.
    const prepared = rows.map((row) => {
      const data = safeParse(row.data);
      return {
        row,
        data,
        canonical: parsePersistedOpenMAEvent(data),
      };
    });
    const canonicalRawEvidence = new Set(
      prepared
        .map(({ canonical }) => canonical?.raw?.payload)
        .filter((payload): payload is unknown => payload !== undefined)
        .map(persistedEventFingerprint),
    );
    const richerCanonicalByRawOccurrence = new Map<string, OpenMAEvent>();
    const canonicalNativeAgentIds = new Set<string>();
    for (const { canonical } of prepared) {
      if (canonical?.work_item_id) {
        const canonicalData = isPlainRecord(canonical.data)
          ? canonical.data
          : {};
        if (
          canonical.type === "work_item.started"
          && canonicalData.kind === "agent"
        ) {
          canonicalNativeAgentIds.add(canonical.work_item_id);
        } else if (canonical.type === "work_item.reidentified") {
          const previousId =
            typeof canonicalData.previous_work_item_id === "string"
              ? canonicalData.previous_work_item_id
              : undefined;
          if (previousId && canonicalNativeAgentIds.has(previousId)) {
            canonicalNativeAgentIds.delete(previousId);
            canonicalNativeAgentIds.add(canonical.work_item_id);
          }
        }
      }
      if (!canonical?.raw?.payload || !canonical.work_item_id) continue;
      // Renderer-derived native transcript events carry work_item_id and
      // are richer than the main ACP projection of the same wire occurrence.
      // Scope the preference to that occurrence: repeated token payloads are
      // valid stream data and must never be deduplicated across timestamps.
      richerCanonicalByRawOccurrence.set(
        persistedCanonicalRawOccurrenceFingerprint(canonical),
        canonical,
      );
    }

    let current: Turn | null = null;
    let order = 0;
    for (const { row: r, data, canonical } of prepared) {
      if (canonical) {
        const canonicalRaw = canonical.raw?.payload;
        const richerCanonical = canonicalRaw !== undefined
          ? richerCanonicalByRawOccurrence.get(
              persistedCanonicalRawOccurrenceFingerprint(canonical),
            )
          : undefined;
        if (
          richerCanonical
          && !canonical.work_item_id
          && richerCanonical.event_id !== canonical.event_id
        ) {
          continue;
        }
        this.#ingestOpenMAEvent(canonical);
        this.#applyCanonicalSessionProjection(canonical);

        // Native harness events (for example Claude subagent lifecycle and
        // nested transcript projections) are already normalized into the
        // canonical stream with a work-item correlation. Rehydrate those
        // records into the existing Agents view before falling through to
        // the parent-turn projection; otherwise replay would silently drop
        // the child activity while still retaining the SQL evidence.
        if (this.#replayCanonicalNativeLifecycle(canonical)) continue;
        if (this.#replayCanonicalNativeTranscript(canonical, r.ts)) continue;

        if (canonical.type === "user.message") {
          const input = isPlainRecord(canonical.data)
            ? canonical.data
            : {};
          const inputKind = input.input_kind;
          if (inputKind === "prompt" || inputKind === "steering") {
            if (current) this.#turns.set(current.id, current);
            const tid = `replay-${sessionId}-${order++}`;
            current = {
              id: tid,
              sessionId,
              promptText: typeof input.text === "string" ? input.text : "",
              attachments: Array.isArray(input.attachments)
                ? input.attachments as PromptAttachment[]
                : undefined,
              sessionReferences: Array.isArray(input.session_references)
                ? input.session_references as PromptSessionReference[]
                : undefined,
              events: [],
              assistantText: "",
              thoughtText: "",
              status: "complete",
              startedAt: r.ts,
              endedAt: r.ts,
            };
          }
          continue;
        }

        if (!current) continue;
        current.endedAt = Math.max(current.endedAt ?? current.startedAt, r.ts);
        if (canonical.type === "turn.completed") {
          current.status = "complete";
          // A provider-owned session.running fact can precede the host-owned
          // turn terminal in the persisted stream (Pi reports exactly this).
          // Replay must respect the later terminal just like the live reducer,
          // otherwise a restart leaves the session permanently "running".
          this.#mutateSession(sessionId, (session) => ({
            ...session,
            status: "ready",
            activeTurnId: undefined,
            lastError: undefined,
          }));
          continue;
        }
        if (canonical.type === "turn.cancelled") {
          current.status = "cancelled";
          continue;
        }
        if (canonical.type === "turn.failed") {
          current.status = "error";
          const errorData = isPlainRecord(canonical.data)
            ? canonical.data
            : undefined;
          current.errorMessage =
            typeof errorData?.message === "string"
              ? errorData.message
              : current.errorMessage;
          continue;
        }
        if (canonical.type === "session.error" && canonical.turn_id) {
          current.status = "error";
          const errorData = isPlainRecord(canonical.data)
            ? canonical.data
            : undefined;
          current.errorMessage =
            typeof errorData?.message === "string"
              ? errorData.message
              : current.errorMessage;
          continue;
        }

        // Content and structural transcript facts are kept in the existing
        // Turn event list. The reducer already understands the canonical
        // envelope, so replay does not need to reconstruct an ACP payload.
        const parsedCanonical = parseAcpEvent(canonical);
        if (parsedCanonical.kind === "text") {
          const split = splitAcpSystemNoticeText(parsedCanonical.text);
          if (split.notice) {
            this.#showNotice(sessionId, split.notice, "warning");
          }
          current.assistantText = mergeStreamingText(
            current.assistantText,
            split.transcript,
          );
          if (split.transcript) {
            this.#appendStreamEvent(current, "text", split.transcript, r.ts, {
              messageId: parsedCanonical.messageId,
              phase: parsedCanonical.phase,
            });
          }
        } else if (parsedCanonical.kind === "thought") {
          current.thoughtText = mergeStreamingText(
            current.thoughtText,
            parsedCanonical.text,
          );
          this.#appendStreamEvent(current, "thought", parsedCanonical.text, r.ts, {
            messageId: parsedCanonical.messageId,
          });
        } else if (
          canonical.type === "tool.started"
          || canonical.type === "tool.progress"
          || canonical.type === "tool.completed"
          || canonical.type === "tool.failed"
          || canonical.type === "tool.cancelled"
          || canonical.type === "plan.updated"
          || canonical.type === "plan.completed"
          || canonical.type === "plan.removed"
        ) {
          current.events.push({ payload: canonical, receivedAt: r.ts });
        }
        continue;
      }

      // A legacy raw row that is already retained inside a canonical
      // envelope is evidence only. Replaying it would duplicate text and
      // tools in the transcript.
      if (canonicalRawEvidence.has(persistedEventFingerprint(data))) continue;

      if (
        this.#applyAcpSessionMetadata(
          sessionId,
          sessionUpdateType(data),
          sessionUpdateInner(data),
        )
      ) {
        continue;
      }
      if (r.type === "user_prompt") {
        // Flush the previous turn, start a new one.
        if (current) this.#turns.set(current.id, current);
        const tid = `replay-${sessionId}-${order++}`;
        current = {
          id: tid,
          sessionId,
          promptText: (data as { text?: string })?.text ?? "",
          attachments: (
            data as { attachments?: PromptAttachment[] }
          )?.attachments,
          sessionReferences: (
            data as { session_references?: PromptSessionReference[] }
          )?.session_references,
          events: [],
          assistantText: "",
          thoughtText: "",
          status: "complete",
          startedAt: r.ts,
          endedAt: r.ts,
        };
      } else if (current) {
        // The prompt row marks the start boundary. Advance the persisted
        // completion boundary with every transcript/activity event that
        // belongs to this turn. Session-only metadata was handled above and
        // continued, so an unrelated usage/title update cannot inflate the
        // displayed work duration.
        current.endedAt = Math.max(current.endedAt ?? current.startedAt, r.ts);
        // Every non-user_prompt row is a stored ACP event. Structural
        // events stay verbatim; adjacent text/thought chunks are compacted
        // into runs so long histories do not rebuild thousands of token
        // objects. Tool boundaries remain in place, preserving the same
        // live ordering. For back-compat, also accept legacy coalesced
        // `agent_message` / `agent_thought` rows.
        if (r.type === "agent_message") {
          const text = (data as { text?: string })?.text ?? "";
          const split = splitAcpSystemNoticeText(text);
          if (split.notice) {
            this.#showNotice(sessionId, split.notice, "warning");
          }
          current.assistantText += split.transcript;
          if (split.transcript) {
            this.#appendStreamEvent(current, "text", split.transcript, r.ts);
          }
        } else if (r.type === "agent_thought") {
          const text = (data as { text?: string })?.text ?? "";
          current.thoughtText += text;
          this.#appendStreamEvent(current, "thought", text, r.ts);
        } else {
        // Legacy persisted chunks are stored as the raw ACP event under each
        // row's `data`. They remain supported for pre-canonical histories.
          const parsed = parseAcpEvent(data);
          if (parsed.kind === "text") {
            const split = splitAcpSystemNoticeText(parsed.text);
            if (split.notice) {
              this.#showNotice(sessionId, split.notice, "warning");
            }
            current.assistantText = mergeStreamingText(
              current.assistantText,
              split.transcript,
            );
            if (split.transcript) {
              this.#appendStreamEvent(current, "text", split.transcript, r.ts, {
                messageId: parsed.messageId,
                phase: parsed.phase,
              });
            }
          } else if (parsed.kind === "thought") {
            current.thoughtText = mergeStreamingText(current.thoughtText, parsed.text);
            this.#appendStreamEvent(current, "thought", parsed.text, r.ts, {
              messageId: parsed.messageId,
            });
          } else {
            current.events.push({ payload: data, receivedAt: r.ts });
          }
        }
      }
    }
    if (current) this.#turns.set(current.id, current);
    if (canonicalNativeAgentIds.size > 0) {
      // Side-workspace snapshots are restored before SQL history. Native
      // subagent tabs are projections of canonical lifecycle events, so a
      // hot reload must discard snapshot-only children that are absent from
      // the replayed stream. Otherwise each reload accumulates another
      // random view id and leaves stale "Running / Thinking" tabs beside a
      // terminal child that has already completed.
      const previousActivities = this.#subagentsByParent.get(sessionId) ?? [];
      const canonicalActivities = previousActivities.filter((activity) =>
        canonicalNativeAgentIds.has(activity.childSessionId),
      );
      const canonicalViewIds = new Set(
        canonicalActivities.map((activity) => activity.viewSessionId),
      );
      const removedViewIds = new Set(
        previousActivities
          .filter((activity) => !canonicalNativeAgentIds.has(activity.childSessionId))
          .map((activity) => activity.viewSessionId),
      );
      const previousTabs = this.#sideTabsByMain.get(sessionId) ?? [];
      const seenCanonicalSubagentViews = new Set<string>();
      const nextTabs = previousTabs.filter((tab) => {
        if (tab.type !== "subagent") return true;
        if (canonicalViewIds.has(tab.payload)) {
          if (seenCanonicalSubagentViews.has(tab.payload)) return false;
          seenCanonicalSubagentViews.add(tab.payload);
          return true;
        }
        removedViewIds.add(tab.payload);
        return false;
      });
      this.#subagentsByParent.set(sessionId, canonicalActivities);
      if (nextTabs.length > 0) this.#sideTabsByMain.set(sessionId, nextTabs);
      else this.#sideTabsByMain.delete(sessionId);
      const activeTabId = this.#activeSideTabByMain.get(sessionId);
      if (activeTabId && !nextTabs.some((tab) => tab.id === activeTabId)) {
        const fallback = nextTabs.at(-1)?.id;
        if (fallback) this.#activeSideTabByMain.set(sessionId, fallback);
        else this.#activeSideTabByMain.delete(sessionId);
      }
      for (const viewSessionId of removedViewIds) {
        const row = this.#sessions.get(viewSessionId);
        if (
          row?.sideKind === "subagent"
          && row.subagent?.parentSessionId === sessionId
        ) {
          this.#sessions.delete(viewSessionId);
        }
        for (const [turnId, turn] of this.#turns) {
          if (turn.sessionId === viewSessionId) this.#turns.delete(turnId);
        }
      }
      this.#syncVisibleSideSession(sessionId);
    }
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
    if (ev.openma_event) this.#ingestOpenMAEvent(ev.openma_event);
    switch (ev.type) {
      case "session.ready": {
        const existing = this.#sessions.get(ev.session_id);
        const pendingBeforeReady = this.#pendingAsksBeforeSession.get(ev.session_id);
        this.#pendingAsksBeforeSession.delete(ev.session_id);
        const canonicalStart =
          ev.openma_event?.type === "session.started"
          && ev.openma_event.data
          && typeof ev.openma_event.data === "object"
            ? ev.openma_event.data as Record<string, unknown>
            : undefined;
        const configOptions =
          normalizeAgentConfigOptions(canonicalStart?.config_options)
          ?? normalizeAgentConfigOptions(ev.config_options)
          ?? (() => {
            const legacyMode = configOptionFromLegacySessionModes(
              canonicalStart?.modes ?? ev.modes,
            );
            return legacyMode ? [legacyMode] : undefined;
          })();
        if (existing) {
          this.#mutateSession(ev.session_id, (s) => ({
            ...s,
            forkParent: undefined,
            acp_session_id: ev.acp_session_id,
            agent_id: ev.agent_id,
            cwd: ev.cwd,
            projectId: ev.project_id ?? s.projectId,
            additionalDirectories:
              ev.additional_directories ?? s.additionalDirectories,
            configOptions: configOptions ?? s.configOptions,
            currentModeId:
              selectedModeIdFromConfigOptions(configOptions) ?? s.currentModeId,
            supportsSessionFork: ev.supports_session_fork ?? s.supportsSessionFork,
            supportsSteering: ev.supports_steering ?? s.supportsSteering,
            protocolVersion: ev.protocol_version ?? s.protocolVersion,
            agentInfo: ev.agent_info ?? s.agentInfo,
            agentCapabilities: ev.agent_capabilities ?? s.agentCapabilities,
            initializeMeta: ev.initialize_meta ?? s.initializeMeta,
            sessionSetupMeta: ev.session_setup_meta ?? s.sessionSetupMeta,
            supportsSessionList: ev.supports_session_list ?? s.supportsSessionList,
            supportsSessionDelete: ev.supports_session_delete ?? s.supportsSessionDelete,
            supportsSessionResume: ev.supports_session_resume ?? s.supportsSessionResume,
            supportsSessionClose: ev.supports_session_close ?? s.supportsSessionClose,
            supportsAdditionalDirectories:
              ev.supports_additional_directories ?? s.supportsAdditionalDirectories,
            supportsLogout: ev.supports_logout ?? s.supportsLogout,
            supportsProviders: ev.supports_providers ?? s.supportsProviders,
            supportsNes: ev.supports_nes ?? s.supportsNes,
            status: s.activeTurnId ? "running" : "ready",
            lastError: undefined,
            pendingAsks:
              pendingBeforeReady?.length
                ? [...(s.pendingAsks ?? []), ...pendingBeforeReady]
                : s.pendingAsks,
          }));
        } else {
          this.#sessions.set(ev.session_id, {
            id: ev.session_id,
            agent_id: ev.agent_id,
            cwd: ev.cwd,
            projectId: ev.project_id,
            additionalDirectories: ev.additional_directories,
            acp_session_id: ev.acp_session_id,
            label: `${ev.agent_id} · ${ev.session_id.slice(0, 6)}`,
            status: "ready",
            createdAt: Date.now(),
            configOptions,
            currentModeId: selectedModeIdFromConfigOptions(configOptions),
            supportsSessionFork: ev.supports_session_fork,
            supportsSteering: ev.supports_steering,
            protocolVersion: ev.protocol_version,
            agentInfo: ev.agent_info,
            agentCapabilities: ev.agent_capabilities,
            initializeMeta: ev.initialize_meta,
            sessionSetupMeta: ev.session_setup_meta,
            supportsSessionList: ev.supports_session_list,
            supportsSessionDelete: ev.supports_session_delete,
            supportsSessionResume: ev.supports_session_resume,
            supportsSessionClose: ev.supports_session_close,
            supportsAdditionalDirectories: ev.supports_additional_directories,
            supportsLogout: ev.supports_logout,
            supportsProviders: ev.supports_providers,
            supportsNes: ev.supports_nes,
            pendingAsks: pendingBeforeReady,
          });
        }
        if (!this.#activeId) this.#activeId = ev.session_id;
        break;
      }
      case "session.event": {
        if (
          ev.openma_event
          && this.#applyCanonicalSessionProjection(ev.openma_event)
        ) {
          break;
        }
        // Some ACP session updates are session-scoped, not turn-scoped —
        // available_commands_update declares the agent's slash command
        // catalog, current_mode_update names the agent's active mode.
        // Both replace prior state on the SessionRow and DO NOT need a
        // matching Turn (they often arrive between turns or right after
        // session.new). Branch on these before the turn-lookup path so
        // we don't synthesize an empty turn just to hold a session-level
        // payload.
        const canonicalTurnEvent =
          ev.openma_event
          && (
            ev.openma_event.type === "tool.started"
            || ev.openma_event.type === "tool.progress"
            || ev.openma_event.type === "tool.completed"
            || ev.openma_event.type === "tool.failed"
            || ev.openma_event.type === "tool.cancelled"
            || ev.openma_event.type === "agent.message"
            || ev.openma_event.type === "agent.message_chunk"
            || ev.openma_event.type === "agent.thinking"
            || ev.openma_event.type === "plan.updated"
            || ev.openma_event.type === "plan.completed"
            || ev.openma_event.type === "plan.removed"
          )
            ? ev.openma_event
            : undefined;
        const semanticEvent = canonicalTurnEvent ?? ev.event;
        if (ev.openma_event) {
          const canonicalSources = extractCanonicalContentSources(
            ev.openma_event,
          );
          if (canonicalSources.length > 0) {
            this.#ingestArtifacts(
              ev.session_id,
              [],
              [],
              canonicalSources,
            );
          }
        }
        const inner = sessionUpdateInner(ev.event);
        const updateType = sessionUpdateType(ev.event);
        let parsed = parseAcpEvent(semanticEvent);
        if (parsed.kind === "text") {
          const split = splitAcpSystemNoticeText(parsed.text);
          if (split.notice) {
            this.#showNotice(ev.session_id, split.notice, "warning");
            if (!split.transcript) break;
            parsed = { ...parsed, text: split.transcript };
          }
        }
        if (parsed.kind === "commands") {
          this.#mutateSession(ev.session_id, (s) => ({
            ...s,
            availableCommands: parsed.commands,
          }));
          break;
        }
        if (parsed.kind === "notice") {
          this.#showNotice(ev.session_id, parsed.notice, "warning");
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
            configOptions: currentModeId
              ? withSelectedSessionMode(s.configOptions, currentModeId)
              : s.configOptions,
          }));
          break;
        }
        if (updateType === "config_option_update") {
          const rawConfigOptions = Array.isArray(inner.configOptions)
            ? inner.configOptions
            : Array.isArray(inner.config_options)
              ? inner.config_options
              : undefined;
          const configOptions = normalizeAgentConfigOptions(rawConfigOptions) ?? [];
          this.#mutateSession(ev.session_id, (s) => ({
            ...s,
            configOptions,
            currentModeId:
              selectedModeIdFromConfigOptions(configOptions) ?? s.currentModeId,
          }));
          break;
        }
        const runtimeAdapter = resolveAgentRuntimeAdapter(
          this.#sessions.get(ev.session_id)?.agent_id,
        );
        const nestedTranscript = runtimeAdapter?.nativeAgentTranscriptUpdates(
          ev.event,
        ) ?? [];
        if (nestedTranscript.length > 0) {
          this.#ingestNativeAgentTranscript(
            ev.session_id,
            nestedTranscript,
            ev.turn_id,
          );
          // A child-correlated usage update belongs to the native work item,
          // not to the parent session usage snapshot. The same rule keeps
          // nested text/thought/tool updates out of the parent transcript.
          break;
        }
        if (
          this.#applyAcpSessionMetadata(ev.session_id, updateType, inner)
        ) {
          break;
        }
        for (const monitorEvent of runtimeAdapter?.monitorRawEvents?.(
          ev.event,
        ) ?? []) {
          this.#ingestOpenMAEvent(runtimeMonitorEventToOpenMAEvent(
            monitorEvent,
            {
              sessionId: ev.session_id,
              turnId: ev.turn_id || undefined,
              occurredAt: new Date().toISOString(),
              adapter: runtimeAdapter!.provider,
            },
          ), { persist: true });
        }
        let turn = this.#turns.get(ev.turn_id);
        if (!turn) {
          turn = {
            id: ev.turn_id,
            sessionId: ev.session_id,
            promptText: "",
            events: [],
            assistantText: "",
            thoughtText: "",
            status: "running",
            startedAt: Date.now(),
          };
          this.#turns.set(ev.turn_id, turn);
        }

        // Fast path for streaming text — bypass React. assistant_message_chunk
        // and agent_thought_chunk arrive at high frequency (one per token);
        // routing them through React state would force a reconciliation per
        // chunk and visibly stall on long messages. Instead we mutate the
        // turn's accumulator in place and broadcast on the stream channel,
        // which the DOM-mutating <StreamingMarkdown> consumes directly.
        // React stays asleep during the stream, except for the first thought
        // chunk: that single publish mounts the existing Reasoning block.
        // Subsequent thought/text chunks stay on the direct stream channel.
        if (parsed.kind === "text" || parsed.kind === "thought") {
          const text = parsed.text;
          if (text.length > 0) {
            const wasShowingThought =
              Boolean(turn.activeThoughtMessageId) ||
              Boolean(turn.activeThoughtSegmentText);
            const assistantNeedsMount =
              parsed.kind === "text" && turn.assistantText.length === 0;
            const isCodex =
              this.#sessions.get(ev.session_id)?.agent_id === "codex-acp";
            const thoughtMessageChanged =
              parsed.kind === "thought" &&
              parsed.messageId !== undefined &&
              parsed.messageId !== turn.activeThoughtMessageId;
            const thoughtSectionBreak =
              parsed.kind === "thought" &&
              isCodex &&
              /\n{2,}/.test(text);
            const thoughtNeedsMount =
              parsed.kind === "thought" &&
              !turn.activeThoughtSegmentText &&
              !thoughtSectionBreak;
            const shouldMountThought =
              parsed.kind === "thought" &&
              (turn.thoughtText.length === 0 ||
                thoughtMessageChanged ||
                thoughtSectionBreak ||
                thoughtNeedsMount);
            // In-place mutate (intentional). React doesn't read this field
            // during the stream — only on turn-complete unmount-and-replace
            // — so identity stability is irrelevant here. The savings:
            // tens of thousands of avoided reconciliations per long turn.
            if (parsed.kind === "text") {
              turn.activeThoughtMessageId = undefined;
              turn.activeThoughtSegmentText = undefined;
              const next = mergeStreamingText(turn.assistantText, text);
              const delta = next.startsWith(turn.assistantText)
                ? next.slice(turn.assistantText.length)
                : "";
              turn.assistantText = next;
              if (delta) this.#emitStream(ev.turn_id, { kind: "assistant", text: delta });
            } else {
              if (thoughtMessageChanged || thoughtSectionBreak) {
                turn.activeThoughtMessageId = parsed.messageId;
                turn.activeThoughtSegmentText = "";
              }
              if (!thoughtSectionBreak) {
                turn.activeThoughtSegmentText = mergeStreamingText(
                  turn.activeThoughtSegmentText ?? "",
                  text,
                );
              }
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
            this.#appendStreamEvent(turn, parsed.kind, text, Date.now(), {
              messageId: parsed.messageId,
              ...(parsed.kind === "text" ? { phase: parsed.phase } : {}),
            });
            if (parsed.kind === "text" && runtimeAdapter?.assistantBackgroundWorkItemUpdates) {
              for (const update of runtimeAdapter.assistantBackgroundWorkItemUpdates(text)) {
                for (const event of runtimeWorkItemUpdateToOpenMAEvents(update, {
                  sessionId: ev.session_id,
                  turnId: ev.turn_id,
                  occurredAt: new Date().toISOString(),
                  adapter: runtimeAdapter.provider,
                })) {
                  this.#ingestOpenMAEvent(event, { persist: true });
                }
              }
            }
            if (
              shouldMountThought ||
              assistantNeedsMount ||
              (parsed.kind === "text" && wasShowingThought)
            ) {
              // Selectors shallow-compare Turn identities. Replace this one
              // object exactly once so the streaming answer or Reasoning
              // block actually mounts; later chunks keep mutating the
              // replacement in place.
              this.#turns.set(ev.turn_id, {
                ...turn,
                events: [...turn.events],
              });
              this.#emit();
            }
            if (ev.openma_event) this.#emit();
            return;
          }
        }

        // Structural event — replace events array AND bump version so React
        // re-renders the affected turn block.
        const nextTurn =
          parsed.kind === "tool_call"
            ? {
                ...turn,
                activeThoughtMessageId: undefined,
                activeThoughtSegmentText: undefined,
              }
            : turn;
        this.#turns.set(ev.turn_id, {
          ...nextTurn,
          events: [...turn.events, { payload: semanticEvent, receivedAt: Date.now() }],
        });
        if (runtimeAdapter) {
          const backgroundLevel = runtimeAdapter.backgroundWorkItemLevel?.(
            ev.event,
          );
          if (backgroundLevel) {
            this.#reconcileBackgroundWorkItemLevel(
              ev.session_id,
              ev.turn_id,
              runtimeAdapter.provider,
              backgroundLevel,
            );
          }
          this.#ingestNativeAgentUpdates(
            ev.session_id,
            runtimeAdapter.nativeAgentRawUpdates(ev.event),
            { turnId: ev.turn_id },
          );
          for (const update of runtimeAdapter.backgroundWorkItemRawUpdates?.(
            ev.event,
          ) ?? []) {
            this.#ingestRuntimeWorkItemUpdate(
              ev.session_id,
              ev.turn_id,
              runtimeAdapter.provider,
              update,
            );
          }
          const rawArtifacts = runtimeAdapter.rawWorkspaceArtifacts?.(ev.event);
          if (rawArtifacts) {
            this.#ingestArtifacts(
              ev.session_id,
              rawArtifacts.outputs.files,
              rawArtifacts.outputs.services,
              rawArtifacts.sources,
            );
          }
        }
        // Ask the active runtime adapter to normalize this tool event into
        // New-tab outputs, explicit sources, and background activity.
        if (parsed.kind === "tool_call") {
          // ACP tool_call_update is a patch. In particular, Claude Code's
          // completed update retains the tool name but omits the raw input
          // URL/path from the initial tool_call. Normalize only after
          // reducing the turn so provider adapters receive the complete
          // logical tool event.
          const tool = reduceTurn(
            this.#turns.get(ev.turn_id)?.events ?? [],
          ).tools.find(
            (candidate) => candidate.toolCallId === parsed.tool.toolCallId,
          ) ?? parsed.tool;
          // Native lifecycle patches are intentionally interpreted in their
          // original provider shape. A bare Claude agent.tool_result means
          // "settle the existing Task context"; reattaching the initial
          // Agent tool name would make it look like a second spawn.
          this.#ingestNativeAgentToolEvent(
            ev.session_id,
            parsed.tool,
            tool,
            ev.turn_id,
          );
          const workItemAdapter = runtimeAdapter ?? genericAcpRuntimeAdapter;
          for (const update of workItemAdapter.planToolUpdates(tool)) {
            const planEvent = runtimePlanUpdateToOpenMAEvent(update, {
              sessionId: ev.session_id,
              turnId: ev.turn_id,
              occurredAt: new Date().toISOString(),
              adapter: workItemAdapter.provider,
            });
            if (this.#ingestOpenMAEvent(planEvent, { persist: true })) {
              const currentTurn = this.#turns.get(ev.turn_id);
              if (currentTurn) {
                this.#turns.set(ev.turn_id, {
                  ...currentTurn,
                  events: [
                    ...currentTurn.events,
                    { payload: planEvent, receivedAt: Date.now() },
                  ],
                });
              }
            }
          }
          for (const update of workItemAdapter.backgroundWorkItemToolUpdates(
            parsed.tool,
            tool,
          )) {
            this.#ingestRuntimeWorkItemUpdate(
              ev.session_id,
              ev.turn_id,
              workItemAdapter.provider,
              update,
            );
          }
          const { outputs, sources } = (
            runtimeAdapter ?? genericAcpRuntimeAdapter
          ).workspaceArtifacts(tool);
          const { files, services } = outputs;
          this.#ingestArtifacts(ev.session_id, files, services, sources);
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
        ], { emitCanonical: !ev.openma_event });
        break;
      }
      case "session.steering": {
        if (ev.outcome === "injected") {
          const turn = this.#turns.get(ev.turn_id);
          if (turn) {
            this.#turns.set(ev.turn_id, {
              ...turn,
              status: "complete",
              effectiveDelivery: ev.effective_delivery,
              deliveryDegraded: ev.delivery_degraded ?? false,
              endedAt: Date.now(),
            });
          }
          this.#advanceAfterTurn(ev.session_id, ev.turn_id);
        } else if (ev.outcome === "startedNewTurn") {
          this.#markTurnRunning(ev.turn_id);
          this.#mutateSession(ev.session_id, (session) => {
            const queuedTurnIds = (session.queuedTurnIds ?? []).filter(
              (turnId) => turnId !== ev.turn_id,
            );
            const queuedPrompts = session.queuedPrompts?.filter(
              (prompt) => prompt.turn_id !== ev.turn_id,
            );
            return {
              ...session,
              activeTurnId: ev.turn_id,
              queuedTurnIds: queuedTurnIds.length > 0 ? queuedTurnIds : undefined,
              queuedPrompts,
              status: "running",
            };
          });
        }
        break;
      }
      case "session.tool_cancelled": {
        const turn = this.#turns.get(ev.turn_id);
        if (turn) {
          turn.events.push({
            payload: ev.openma_event ?? {
              schema_version: "oma.event.v1",
              event_id: `tool-cancelled:${ev.session_id}:${ev.turn_id}:${ev.tool_call_id}`,
              type: "tool.cancelled",
              session_id: ev.session_id,
              turn_id: ev.turn_id,
              source: { kind: "openma", adapter: "acp-client" },
              occurred_at: new Date().toISOString(),
              data: {
                tool_call_id: ev.tool_call_id,
                status: "cancelled",
                reason: ev.reason,
              },
            },
            receivedAt: Date.now(),
          });
        }
        break;
      }
      case "session.cancelled": {
        const turn = this.#turns.get(ev.turn_id);
        if (turn) {
          this.#turns.set(ev.turn_id, {
            ...turn,
            status: "cancelled",
            endedAt: Date.now(),
          });
        }
        this.#advanceAfterTurn(ev.session_id, ev.turn_id);
        break;
      }
      case "session.complete": {
        const turn = this.#turns.get(ev.turn_id);
        if (turn) {
          const runtimeAdapter = resolveAgentRuntimeAdapter(
            this.#sessions.get(ev.session_id)?.agent_id,
          );
          if (runtimeAdapter?.assistantNativeAgentUpdates) {
            this.#ingestNativeAgentUpdates(
              ev.session_id,
              runtimeAdapter.assistantNativeAgentUpdates(turn.assistantText),
              { turnId: ev.turn_id },
            );
          }
          const assistantArtifacts = runtimeAdapter?.assistantArtifacts?.(
            turn.assistantText,
          );
          if (assistantArtifacts) {
            this.#ingestArtifacts(
              ev.session_id,
              assistantArtifacts.outputs.files,
              assistantArtifacts.outputs.services,
              assistantArtifacts.sources,
            );
          }
          this.#turns.set(ev.turn_id, {
            ...turn,
            // Streaming chunks compact into turn.events in place to avoid a
            // React render per token. Publish a fresh array at the terminal
            // boundary so consumers memoized by events identity reduce the
            // trailing text that arrived after the last structural event.
            events: [...turn.events],
            activeThoughtMessageId: undefined,
            activeThoughtSegmentText: undefined,
            status: "complete",
            endedAt: Date.now(),
          });
          this.#settleNativeSubagentsForTurn(ev.session_id, turn);
          this.#settleBackgroundWorkItemsForTurn(ev.session_id, turn);
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
        const nextQueuedIds = ev.queued.map((prompt) => prompt.turn_id);
        const nextQueued = new Set(nextQueuedIds);
        const steeringTurnIds = ev.steering_turn_ids ?? [];
        const steeringTurns = new Set(steeringTurnIds);
        const previous = this.#sessions.get(ev.session_id);
        const previousQueued = new Set(
          previous?.queuedTurnIds ?? previous?.queuedPrompts?.map((prompt) => prompt.turn_id) ?? [],
        );
        for (const turnId of previousQueued) {
          if (
            nextQueued.has(turnId)
            || steeringTurns.has(turnId)
            || turnId === ev.active_turn_id
          ) continue;
          const turn = this.#turns.get(turnId);
          if (turn?.sessionId === ev.session_id && turn.status === "queued") {
            this.#turns.delete(turnId);
          }
        }
        for (const turnId of steeringTurnIds) {
          this.#markTurnRunning(turnId);
        }
        for (const prompt of ev.queued) {
          const turn = this.#turns.get(prompt.turn_id);
          if (turn?.sessionId === ev.session_id) {
            this.#turns.set(prompt.turn_id, {
              ...turn,
              promptText: prompt.text,
              status: "queued",
            });
          }
        }
        this.#markTurnRunning(ev.active_turn_id ?? undefined);
        this.#mutateSession(ev.session_id, (s) => ({
          ...s,
          activeTurnId: ev.active_turn_id ?? undefined,
          queuedTurnIds: nextQueuedIds.length ? nextQueuedIds : undefined,
          queuedPrompts: ev.queued,
          status: ev.active_turn_id
            || steeringTurnIds.length > 0
            ? "running"
            : s.status === "running"
              ? "ready"
              : s.status,
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
        this.#openmaEventsBySession.delete(ev.session_id);
        const noticeTimer = this.#noticeTimers.get(ev.session_id);
        if (noticeTimer) clearTimeout(noticeTimer);
        this.#noticeTimers.delete(ev.session_id);
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
    return [...this.#pairs.values()]
      .filter((pair) => pair.archivedAt == null)
      .sort((a, b) => {
        const pinnedDelta = Number(b.pinnedAt != null) - Number(a.pinnedAt != null);
        return pinnedDelta || b.lastUsedAt - a.lastUsedAt;
      });
  }

  pair(id: string): PairRow | null {
    return this.#pairs.get(id) ?? null;
  }

  /** Rename a pair-chat wrapper and persist its title through pairSave. */
  async renamePair(pairId: string, title: string): Promise<void> {
    const pair = this.#pairs.get(pairId);
    const trimmed = title.trim();
    if (!pair || !trimmed) return;
    pair.label = trimmed.slice(0, 500);
    this.#persistPair(pair);
    this.#emit();
  }

  pinPair(pairId: string): void {
    const pair = this.#pairs.get(pairId);
    if (!pair) return;
    pair.pinnedAt = Date.now();
    void window.backchat.pairsPin({ pair_id: pairId });
    this.#emit();
  }

  unpinPair(pairId: string): void {
    const pair = this.#pairs.get(pairId);
    if (!pair) return;
    pair.pinnedAt = undefined;
    void window.backchat.pairsUnpin({ pair_id: pairId });
    this.#emit();
  }

  archivePair(pairId: string): void {
    const pair = this.#pairs.get(pairId);
    if (!pair) return;
    pair.archivedAt = Date.now();
    void window.backchat.pairsArchive({ pair_id: pairId });
    this.#emit();
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
            ...m,
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
          openma_event: ev.openma_event,
        });
        return;
      }
      case "pair.complete": {
        const {
          type: _type,
          pair_id: _pairId,
          member_session_id: memberSessionId,
          ...completion
        } = ev;
        this.apply({
          type: "session.complete",
          session_id: memberSessionId,
          ...completion,
        });
        this.#dropPairPending(ev.pair_id, ev.member_session_id);
        return;
      }
      case "pair.error": {
        const {
          type: _type,
          pair_id: _pairId,
          member_session_id: memberSessionId,
          ...failure
        } = ev;
        this.apply({
          type: "session.error",
          session_id: memberSessionId,
          ...failure,
        });
        if (ev.member_session_id) {
          this.#dropPairPending(ev.pair_id, ev.member_session_id);
        }
        return;
      }
      case "pair.session_event": {
        this.apply(ev.session_event);
        if (ev.session_event.type === "session.cancelled") {
          this.#dropPairPending(
            ev.pair_id,
            ev.member_session_id,
            ev.session_event.turn_id,
          );
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
  registerPairTurn(
    pair_id: string,
    text: string,
    sessionReferences: PromptSessionReference[] = [],
    attachments: PromptAttachment[] = [],
  ): PairTurnTarget[] | null {
    const pair = this.#pairs.get(pair_id);
    if (!pair) return null;
    const groupTurnId = `pairturn-${Math.random().toString(36).slice(2, 10)}`;
    const targets: PairTurnTarget[] = pair.members.map((sid) => ({
      session_id: sid,
      turn_id: `turn-${Math.random().toString(36).slice(2, 10)}`,
    }));
    for (const sid of pair.members) {
      const target = targets.find((t) => t.session_id === sid);
      if (target) {
        this.registerTurn(
          target.turn_id,
          sid,
          text,
          undefined,
          sessionReferences,
          attachments,
        );
      }
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
    sessionId
      ? s.artifactsFor(sessionId)
      : { files: [], services: [], sources: [] };
export const selectSubagentsFor =
  (sessionId: string | null | undefined) => (s: SessionStore) =>
    sessionId ? s.subagentsFor(sessionId) : [];
export const selectWorkItemsFor =
  (sessionId: string | null | undefined) => (s: SessionStore) =>
    sessionId ? s.workItemsFor(sessionId) : [];
export const selectOpenMAEventsFor =
  (sessionId: string | null | undefined) => (s: SessionStore) =>
    sessionId ? s.openmaEventsFor(sessionId) : [];
export const selectSubagentByChildId =
  (childSessionId: string | null | undefined) => (s: SessionStore) =>
    childSessionId ? s.subagentByChildId(childSessionId) : null;
export const selectTurnsFor = (sessionId: string) => (s: SessionStore) =>
  s.turnsFor(sessionId);
export const selectAgentIdFor = (sessionId: string) => (s: SessionStore) =>
  s.get(sessionId)?.agent_id;

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

function normalizeSessionUsage(
  value: Record<string, unknown>,
): AcpSessionUsage | undefined {
  const used = value.used;
  const size = value.size;
  if (
    typeof used !== "number" ||
    !Number.isFinite(used) ||
    used < 0 ||
    typeof size !== "number" ||
    !Number.isFinite(size) ||
    size <= 0
  ) {
    return undefined;
  }

  const rawCost = value.cost;
  let cost: AcpSessionUsage["cost"];
  if (isPlainRecord(rawCost)) {
    const amount = rawCost.amount;
    const currency = rawCost.currency;
    if (
      typeof amount === "number" &&
      Number.isFinite(amount) &&
      amount >= 0 &&
      typeof currency === "string" &&
      currency.trim()
    ) {
      cost = { amount, currency: currency.trim() };
    }
  }

  return { used, size, ...(cost ? { cost } : {}) };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function deepMergeRecords(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const previous = next[key];
    next[key] =
      isPlainRecord(previous) && isPlainRecord(value)
        ? deepMergeRecords(previous, value)
        : value;
  }
  return next;
}

function activeSessionGoalUpdate(
  update: SessionGoal | null | undefined,
): SessionGoal | null | undefined {
  if (!update) return update;
  const status = update.status.trim().toLowerCase();
  return status === "complete" || status === "completed" ? null : update;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function parsePersistedOpenMAEvent(value: unknown): OpenMAEvent | null {
  if (!isPlainRecord(value)) return null;
  if (
    (value.schema !== "oma.event.v1"
      && value.schema_version !== "oma.event.v1")
    || typeof value.event_id !== "string"
    || typeof value.type !== "string"
    || typeof value.session_id !== "string"
    || typeof value.occurred_at !== "string"
    || !isPlainRecord(value.source)
    || typeof value.source.kind !== "string"
    || !("data" in value)
  ) {
    return null;
  }
  return value as unknown as OpenMAEvent;
}

function persistedEventFingerprint(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function persistedCanonicalRawOccurrenceFingerprint(event: OpenMAEvent): string {
  return persistedEventFingerprint([
    event.raw?.received_at ?? event.occurred_at,
    event.raw?.payload,
  ]);
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
