import { isRestartableAgentInterruption } from "./agent-interruption";
import {
  patchAssociation,
  patchSessionMessage,
  wireSessionId,
  wireRecord,
  isParentSubagentLaunchTool,
  isSyntheticSubagentToolCallId,
  parentSubagentToolTask,
  sessionMessageText,
  toolCallIdFromSessionMessageId,
  type SubagentAssociation,
} from "./subagent-sessions";
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
import type { OpenmaScope, OpenmaExecutionTarget, OpenmaTask, OpenmaTaskSnapshot, OpenmaTaskUpdate } from "@shared/openma";
import { projectOpenmaTask } from "./openma-task-projection";
import type {
  PromptAttachment,
  PromptAnnotation,
  PromptSessionReference,
  SessionEventOut,
} from "@shared/session-events.js";
import type { BrowserPluginStateEvent } from "@shared/browser-plugin.js";
import { splitAcpSystemNoticeText } from "@shared/acp-system-notices.js";
import {
  isAuthenticationFailureMessage,
  isAuthenticationRequiredError,
  isStickyProviderErrorMessage,
  sanitizeAuthenticationMessage,
  sessionErrorDetails,
} from "@shared/auth-errors.js";
import { forkSupportFromWire } from "@shared/fork-support.js";
import type { AcpForkPoint } from "@openma/common/acp-runtime";
import {
  messageForkEnabled,
  wholeSessionForkEnabled,
} from "./fork-support.js";
import { forkPointsByTurn } from "./fork-point.js";
import { sessionUsesManagedWorkspace } from "./fork-workspace";
import {
  createOpenMAEvent,
  createVendorEvent,
  createWorkItemProjector,
  type OpenMAEvent,
  type WorkItemProjector,
  type WorkItemRegistry,
  type WorkItemSnapshot,
} from "@openma/common/session-events/openma";

/** One session's canonical OpenMA log. Append-only with O(1) dedupe; the
 *  WorkItem registry is projected incrementally as events arrive, and the
 *  read views are cached until the next change. */
interface OpenMAEventLog {
  events: OpenMAEvent[];
  ids: Set<string>;
  workItems: WorkItemProjector;
  eventsView?: readonly OpenMAEvent[];
  workItemsView?: { registry: WorkItemRegistry; items: WorkItemSnapshot[] };
}

const EMPTY_OPENMA_EVENTS: readonly OpenMAEvent[] = [];

function createOpenMAEventLog(): OpenMAEventLog {
  return { events: [], ids: new Set(), workItems: createWorkItemProjector() };
}
import { setRightRailCollapsed } from "@/lib/right-rail";
import {
  configOptionFromLegacySessionModes,
  normalizeAgentConfigOptions,
  selectedModeIdFromConfigOptions,
  withSelectedSessionMode,
  type AcpSessionConfigOption,
} from "./session-config-options";
import {
  createBackchatTurnProjector,
  parseAcpEvent,
  sessionUpdateInner,
  sessionUpdateType,
  type TurnRender,
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
import { withoutAuthSlashCommands } from "./auth-method-menu";
import type {
  AcpAvailableCommand,
  AcpSessionUsage,
  BrokerAsk,
  HistoryRow,
  HistoryWindowInfo,
  HistoryWindowState,
  NativeAgentLifecycleFact,
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
  TurnEvent,
  TurnDeliveryMeta,
  WorkspaceArtifacts,
  WorkspaceSourceRef,
} from "./session-types";

export type { AcpSessionConfigOption } from "./session-config-options";
export type * from "./session-types";

export interface SessionStoreDependencies {
  readSessionGoalUpdate?: SessionGoalUpdateReader;
}

interface TurnProjectionCacheEntry {
  projector: ReturnType<typeof createBackchatTurnProjector>;
  applied: number;
  first?: Turn["events"][number];
  last?: Turn["events"][number];
}

export class SessionStore {
  #rfdAppliedEvents = new Set<string>();
  /** Child turns whose assistantText was seeded from native.result before any
   *  stream chunk. The matching first chunk must not append again. */
  #resultSeededTurns = new Set<string>();
  #rfdAssociations = new Map<string, SubagentAssociation>();
  #rfdKey(root: string, child: string): string { return JSON.stringify([root, child]); }
  #rfdView(root: string, child: string): string | undefined {
    const association = this.#rfdAssociations.get(this.#rfdKey(root, child));
    if (!association) return undefined;
    return [...this.#sessions.values()].find((row) => row.subagentAssociation === association)?.id;
  }

  /** Match an RFD child to the parent turn's Subagent launch tool when the
   *  RFD update only carried a synthetic rfd:<sessionId> toolCallId. */
  #correlateRfdParentTool(
    parentSessionId: string,
    turnId: string | undefined,
    retainToolCallId?: string,
  ): { toolCallId?: string; task?: string } {
    const turn = turnId ? this.#turns.get(turnId) : undefined;
    if (
      retainToolCallId
      && !isSyntheticSubagentToolCallId(retainToolCallId)
    ) {
      // Id already bound (possibly while rawInput was still empty). Still
      // read task from the projected tool so later prompt patches surface.
      const tool = turn
        ? this.projectTurn(turn).tools.find(
          (candidate) => candidate.toolCallId === retainToolCallId,
        )
        : undefined;
      return {
        toolCallId: retainToolCallId,
        task: tool ? parentSubagentToolTask(tool.rawInput) : undefined,
      };
    }
    if (!turn) return {};
    const claimed = new Set(
      (this.#subagentsByParent.get(parentSessionId) ?? [])
        .map((activity) => activity.native?.toolCallId)
        .filter((id): id is string => typeof id === "string" && !isSyntheticSubagentToolCallId(id)),
    );
    if (retainToolCallId && !isSyntheticSubagentToolCallId(retainToolCallId)) {
      claimed.delete(retainToolCallId);
    }
    // Prefer projected tools so tool_call_update rawInput patches are visible.
    for (const tool of this.projectTurn(turn).tools) {
      if (!isParentSubagentLaunchTool(tool)) continue;
      if (claimed.has(tool.toolCallId)) continue;
      return {
        toolCallId: tool.toolCallId,
        task: parentSubagentToolTask(tool.rawInput),
      };
    }
    return {};
  }

  /** When a parent Subagent tool arrives after the RFD announce, backfill the
   *  synthetic toolCallId / empty task so chips and child promptText resolve.
   *  Also refresh task when the tool was already bound but rawInput later
   *  gained a prompt (DSH often streams tool_call then tool_call_update). */
  #backfillRfdActivityFromParentTool(
    parentSessionId: string,
    tool: { toolCallId: string; title?: string | null; toolName?: string | null; rawInput?: unknown },
  ): void {
    if (!isParentSubagentLaunchTool(tool)) return;
    const list = this.#subagentsByParent.get(parentSessionId) ?? [];
    const taskFromTool = parentSubagentToolTask(tool.rawInput);
    const bound = list.find(
      (activity) => activity.native?.toolCallId === tool.toolCallId,
    );
    if (bound?.native) {
      if (!taskFromTool || bound.task.trim() === taskFromTool) return;
      this.#upsertNativeSubagentActivity(parentSessionId, {
        provider: bound.native.provider,
        operation: "subagent_spawn",
        childId: bound.childSessionId,
        toolCallId: tool.toolCallId,
        task: taskFromTool,
        nickname: bound.native.nickname,
        ...(bound.status === "draft" ? {} : { status: bound.status }),
      });
      return;
    }
    const pending = list.find(
      (activity) =>
        activity.native?.toolCallId
        && isSyntheticSubagentToolCallId(activity.native.toolCallId),
    );
    if (!pending?.native) return;
    const task =
      pending.task.trim()
      || taskFromTool
      || pending.task;
    this.#upsertNativeSubagentActivity(parentSessionId, {
      provider: pending.native.provider,
      operation: "subagent_spawn",
      childId: pending.childSessionId,
      toolCallId: tool.toolCallId,
      task,
      nickname: pending.native.nickname,
      ...(pending.status === "draft" ? {} : { status: pending.status }),
    });
  }

  #refineRfdActivityFromSessionMessage(
    root: string,
    parentView: string,
    update: Record<string, unknown>,
  ): void {
    if (typeof update.messageId !== "string") return;
    const message = patchSessionMessage(undefined, update);
    if (!message) return;
    const text = sessionMessageText(message.content);
    const fromToolResult = toolCallIdFromSessionMessageId(message.messageId);

    // session_message rows are stored on the scoped view (child view when the
    // wire session is the child). Prefer that view's activity.
    const rootActivities = this.#subagentsByParent.get(root) ?? [];
    const nestedParent = parentView !== root
      ? (this.#subagentsByParent.get(parentView) ?? [])
      : [];
    const activity =
      rootActivities.find((item) => item.viewSessionId === parentView)
      ?? nestedParent.find((item) => item.viewSessionId === parentView)
      ?? rootActivities.find(
        (item) => item.childSessionId === message.senderSessionId
          || item.childSessionId === message.recipientSessionId,
      );
    if (!activity?.native) return;

    const sender = message.senderSessionId;
    const rootAcp = this.#sessions.get(root)?.acp_session_id;
    const isParentToChild =
      Boolean(sender && rootAcp && sender === rootAcp)
      || Boolean(
        message.recipientSessionId
        && message.recipientSessionId === activity.childSessionId
        && sender !== activity.childSessionId,
      );
    const patchTask =
      isParentToChild && text && !activity.task.trim() ? text : undefined;
    const patchToolCallId =
      fromToolResult
      && (
        !activity.native.toolCallId
        || isSyntheticSubagentToolCallId(activity.native.toolCallId)
      )
        ? fromToolResult
        : undefined;
    if (!patchTask && !patchToolCallId) return;
    this.#upsertNativeSubagentActivity(
      activity.parentSessionId,
      {
        provider: activity.native.provider,
        operation: "subagent_spawn",
        childId: activity.childSessionId,
        toolCallId: patchToolCallId ?? activity.native.toolCallId,
        task: patchTask ?? activity.task,
        nickname: activity.native.nickname,
        ...(activity.status === "draft" ? {} : { status: activity.status }),
      },
    );
  }

  #applySubagentSession(root: string, event: unknown, turnId?: string): boolean {
    const outer = wireRecord(event);
    const update = outer.update ? wireRecord(outer.update) : outer;
    const wireId = wireSessionId(event);
    if (!wireId) return false;
    const rootRow = this.#sessions.get(root);
    if (!rootRow) return false;
    const parentView = wireId === rootRow.acp_session_id ? root : this.#rfdView(root, wireId);
    if (update.sessionUpdate === "subagent_update") {
      if (!parentView || typeof update.sessionId !== "string" || update.sessionId === rootRow.acp_session_id) return true;
      const key = this.#rfdKey(root, update.sessionId);
      const previous = this.#rfdAssociations.get(key);
      const next = patchAssociation(previous, wireId, update);
      if (!next) return true;
      this.#rfdAssociations.set(key, next);
      const parentAgent = this.#sessions.get(root)?.agent_id;
      const provider = parentAgent === "dsh-acp" ? "dsh" : "claude";
      const state = next.state;
      const status = state?.state === "running" || state?.state === "requires_action" ? "running"
        : state?.state === "idle" && state.stopReason === "cancelled" ? "cancelled"
        : state?.state === "idle" && state.stopReason === "error" ? "error"
        : state?.state === "idle" && state.stopReason === "end_turn" ? "complete" : "unknown";
      // RFD/DSH announce children with session ids, while the parent turn's
      // launch tool keeps a real ACP toolCallId (e.g. call_00_…). Correlate
      // when possible so transcript chips can key off rendered tools.
      const existing = this.#subagentsByParent.get(parentView)?.find(
        (item) => item.childSessionId === next.sessionId,
      );
      const correlated = this.#correlateRfdParentTool(parentView, turnId, existing?.native?.toolCallId);
      const description =
        typeof next.description === "string" && next.description.trim()
          ? next.description.trim()
          : undefined;
      const toolCallId =
        (existing?.native?.toolCallId
          && !isSyntheticSubagentToolCallId(existing.native.toolCallId)
          ? existing.native.toolCallId
          : undefined)
        ?? correlated.toolCallId
        ?? `rfd:${next.sessionId}`;
      const task =
        description
        ?? (existing?.task?.trim() ? existing.task : undefined)
        ?? correlated.task
        ?? "";
      this.#upsertNativeSubagentActivity(parentView, {
        provider, operation: "subagent_spawn", childId: next.sessionId,
        toolCallId, task,
        nickname: next.title ?? undefined, status,
      });
      const activity = this.#subagentsByParent.get(parentView)?.find((item) => item.childSessionId === next.sessionId);
      if (activity) {
        this.#mutateSession(activity.viewSessionId, (row) => ({ ...row,
          acp_session_id: next.sessionId, subagentAssociation: next,
          label: next.title ?? next.sessionId,
        }));
      }
      return true;
    }
    // I11: ownership requires a structured child association. A missing or
    // stale root wire id (startup/reconnect) is not evidence of a child.
    if (!parentView) return false;
    if (update.sessionUpdate === "session_message" || update.sessionUpdate === "session_message_chunk") {
      this.#mutateSession(parentView, (row) => {
        const messages = [...(row.sessionMessages ?? [])];
        const index = messages.findIndex((message) => message.messageId === update.messageId);
        const message = patchSessionMessage(index < 0 ? undefined : messages[index], update);
        if (!message) return row;
        if (index < 0) messages.push(message); else messages[index] = message;
        return { ...row, sessionMessages: messages };
      });
      // Parent→child task text and DSH tool-result message ids refine the
      // linked native activity used by the parent chip + child side chat.
      this.#refineRfdActivityFromSessionMessage(root, parentView, update);
      return true;
    }
    if (parentView === root) return false;
    if (update.sessionUpdate === "config_option_update" || update.sessionUpdate === "session_info_update" || update.sessionUpdate === "usage_update") {
      if (update.sessionUpdate === "config_option_update") this.#mutateSession(parentView, (row) => ({ ...row, configOptions: normalizeAgentConfigOptions(update.configOptions) ?? [] }));
      else this.#applyAcpSessionMetadata(parentView, String(update.sessionUpdate), update);
      return true;
    }
    const childTurn = `${parentView}:turn`;
    const previousTurn = this.#turns.get(childTurn);
    if (!previousTurn) return true;
    const parsed = parseAcpEvent(update);
    const now = Date.now();
    const nextTurn = { ...previousTurn, events: [...previousTurn.events] };
    if (parsed.kind === "text") {
      // Native result may seed the answer before RFD/stream frames arrive
      // (Claude Task tool + child agent_message_chunk). Consume that seed
      // once so CHILD_RFD_OK is not glued into CHILD_RFD_OKCHILD_RFD_OK.
      if (
        this.#resultSeededTurns.has(childTurn)
        && previousTurn.assistantText.length > 0
        && previousTurn.assistantText === parsed.text
      ) {
        this.#resultSeededTurns.delete(childTurn);
        if (previousTurn.events.length === 0) {
          this.#appendStreamEvent(nextTurn, "text", parsed.text, now);
        }
      } else {
        this.#resultSeededTurns.delete(childTurn);
        nextTurn.assistantText += parsed.text;
        this.#appendStreamEvent(nextTurn, "text", parsed.text, now);
      }
    } else if (parsed.kind === "thought") {
      nextTurn.thoughtText += parsed.text;
      this.#appendStreamEvent(nextTurn, "thought", parsed.text, now);
    } else {
      nextTurn.events.push({ payload: update, receivedAt: now });
    }
    this.#turns.set(childTurn, nextTurn);
    return true;
  }

  static readonly NOTICE_DURATION_MS = 10_000;

  #readSessionGoalUpdate: SessionGoalUpdateReader;

  #sessions = new Map<string, SessionRow>();
  /** Blocking broker asks can arrive before session.ready during reload.
   *  Retain them by session id until the matching row is restored. */
  #pendingAsksBeforeSession = new Map<string, BrokerAsk[]>();
  #turns = new Map<string, Turn>();
  #turnProjectionCache = new Map<string, TurnProjectionCacheEntry>();
  /** Coalesced text/thought runs built by #appendStreamEvent, by event. */
  #streamRuns = new WeakMap<TurnEvent, {
    kind: "text" | "thought";
    text: string;
    messageId?: string;
    phase?: "commentary" | "final_answer";
  }>();
  /** Turns created by the replay pass in progress; safe to extend in place. */
  #replayOwnedTurns = new WeakSet<Turn>();
  /** Persisted rows currently materialized per session when history was
   *  opened as a tail window (see replayHistoryWindow / prependHistory). */
  #history = new Map<string, HistoryWindowState>();
  /** Sessions whose first history fetch is in flight. The chat view shows a
   *  loading surface instead of flashing the home empty state. */
  #historyPending = new Set<string>();
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
  #openmaEventsBySession = new Map<string, OpenMAEventLog>();
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
   *  Tool/plan events still break runs because they remain between segments.
   *
   *  Returns whether this text opened a new segment rather than extending the
   *  last one. A new segment needs one React publish to mount its own live
   *  tail; without it the segment exists in the event list but nothing renders
   *  it, and the text stays invisible until the next structural event. */
  #appendStreamEvent(
    turn: Turn,
    kind: "text" | "thought",
    text: string,
    receivedAt: number,
    metadata?: {
      messageId?: string;
      phase?: "commentary" | "final_answer";
    },
  ): boolean {
    const last = turn.events.at(-1);
    // A run this method built is read from its record. Re-parsing the merged
    // payload would rescan the whole accumulated text on every token.
    const run = last ? this.#streamRuns.get(last) : undefined;
    const parsedLast = run ?? (last ? parseAcpEvent(last.payload) : null);
    const sameMessage =
      parsedLast?.kind === kind &&
      parsedLast.messageId === metadata?.messageId &&
      (kind !== "text" ||
        (parsedLast.kind === "text" &&
          parsedLast.phase === metadata?.phase));
    if (sameMessage) {
      const merged = parsedLast.text + text;
      const event: TurnEvent = {
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
      turn.events[turn.events.length - 1] = event;
      this.#streamRuns.set(event, { ...metadata, kind, text: merged });
      return false;
    }
    const event: TurnEvent = {
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
    };
    turn.events.push(event);
    this.#streamRuns.set(event, { ...metadata, kind, text });
    return true;
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

  setExecutionTarget(id: string, target: OpenmaExecutionTarget | undefined): void {
    const row = this.#sessions.get(id);
    if (!row || row.status !== "draft") throw new Error("This task's execution location is fixed");
    this.#sessions.set(id, { ...row, executionTarget: target });
    this.#emit();
  }

  seedOpenmaTasks(tasks: OpenmaTask[]): void {
    for (const task of tasks) {
      const previous = this.#sessions.get(task.id);
      if (previous?.openma && (task.revision ?? 0) < (previous.openma.revision ?? 0)) continue;
      const row = projectOpenmaTask({ task, events: [], operations: [], connection: "offline" }).row;
      if (previous && !previous.openma) continue;
      this.#sessions.set(task.id, previous ? { ...previous,
        label: row.label, status: row.status, openma: task, executionTarget: task.target,
        pinnedAt: row.pinnedAt, archivedAt: row.archivedAt,
      } : row);
    }
    this.#emit();
  }

  applyOpenmaSnapshot(snapshot: OpenmaTaskSnapshot): void {
    const current = this.#sessions.get(snapshot.task.id)?.openma;
    if (current && snapshot.task.afterSeq < current.afterSeq) return;
    if (current && (snapshot.task.revision ?? 0) < (current.revision ?? 0)) snapshot = { ...snapshot, task: current };
    const { row, turns } = projectOpenmaTask(snapshot);
    const previous = this.#sessions.get(row.id);
    this.#sessions.set(row.id, { ...previous, ...row });
    const ids = new Set(turns.map((turn) => turn.id));
    for (const [id, turn] of this.#turns) if (turn.sessionId === row.id && !ids.has(id)) this.#deleteTurn(id);
    for (const turn of turns) {
      const old = this.#turns.get(turn.id);
      const corrected = !!old && (!turn.assistantText.startsWith(old.assistantText) || !turn.thoughtText.startsWith(old.thoughtText));
      turn.streamRevision = (old?.streamRevision ?? 0) + (corrected ? 1 : 0);
      this.#turns.set(turn.id, turn);
      if (old && !corrected) {
        const assistant = turn.assistantText.slice(old.assistantText.length);
        const thought = turn.thoughtText.slice(old.thoughtText.length);
        if (assistant) this.#emitStream(turn.id, { kind: "assistant", text: assistant });
        if (thought) this.#emitStream(turn.id, { kind: "thought", text: thought });
      }
    }
    this.#emit();
  }

  clearOpenmaTasks(): void { this.retainOpenmaScopes([]); }

  retainOpenmaScopes(scopes: readonly OpenmaScope[]): void {
    for (const [id, row] of this.#sessions) {
      const owner = row.openma ?? row.executionTarget;
      if (owner && !scopes.some((scope) => scope.baseUrl === owner.baseUrl && scope.userId === owner.userId && scope.workspaceId === owner.workspaceId)) {
        this.#sessions.delete(id);
        for (const [turnId, turn] of this.#turns) if (turn.sessionId === id) this.#deleteTurn(turnId);
      }
    }
    this.#emit();
  }

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
      .sort(
        (a, b) =>
          (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt) ||
          b.createdAt - a.createdAt,
      );
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

  #forkLineageParent(session: SessionRow | undefined): string | undefined {
    if (!session) return undefined;
    return session.parentSessionId
      ?? session.forkParent?.parentSessionId
      ?? (session.sideParent?.inheritance === "fork"
        ? session.sideParent.parentSessionId
        : undefined);
  }

  #ownTurnsFor(sessionId: string): Turn[] {
    return [...this.#turns.values()].filter(
      (t) => t.sessionId === sessionId && !t.inherited,
    );
  }

  #parentTurnsIncludedInFork(
    parentTurns: Turn[],
    forkKind: SessionRow["forkKind"],
    forkPoint?: AcpForkPoint,
  ): Turn[] {
    if (forkKind !== "message" || !forkPoint) return parentTurns;
    const points = forkPointsByTurn(parentTurns);
    for (let index = 0; index < parentTurns.length; index += 1) {
      const point = points.get(parentTurns[index]!.id);
      if (point?.messageId === forkPoint.messageId) {
        return parentTurns.slice(0, index + 1);
      }
    }
    return parentTurns;
  }

  #cloneInheritedTurn(childId: string, turn: Turn): Turn {
    return {
      ...turn,
      id: `inherited-${childId}-${turn.id}`,
      sessionId: childId,
      inherited: true,
      status: turn.status === "running" ? "complete" : turn.status,
      events: turn.events,
    };
  }

  turnsFor(sessionId: string): Turn[] {
    // Registration order, which is what this Map already holds: replayed turns
    // are built from persisted rows in stored sequence, and live turns are
    // appended as they start. Re-registering an existing id keeps its original
    // position, which is the intent.
    //
    // It used to sort by `startedAt`, a client-side Date.now(). That reordered
    // turns whose clock disagreed with their sequence — a turn synthesized from
    // its first event can stamp itself after a turn that started before it —
    // and rendered a newly sent prompt inside an earlier turn's output.
    const own = this.#ownTurnsFor(sessionId);
    const session = this.#sessions.get(sessionId);
    const parentId = this.#forkLineageParent(session);
    if (!parentId) return own;
    const parentTurns = this.#parentTurnsIncludedInFork(
      this.#ownTurnsFor(parentId),
      session?.forkKind
        ?? (session?.forkParent?.point ? "message" : "session"),
      session?.forkPoint ?? session?.forkParent?.point,
    );
    const inherited = parentTurns.map((turn) =>
      this.#cloneInheritedTurn(sessionId, turn),
    );
    return [...inherited, ...own];
  }

  projectTurn = (turn: Turn): TurnRender => {
    const events = turn.events;
    const cached = this.#turnProjectionCache.get(turn.id);
    if (
      cached
      && events[0] === cached.first
      && events.length >= cached.applied
      && (cached.applied === 0 || events[cached.applied - 1] === cached.last)
    ) {
      for (let index = cached.applied; index < events.length; index += 1) {
        cached.projector.apply(events[index]!);
      }
      cached.applied = events.length;
      cached.first = events[0];
      cached.last = events.at(-1);
      return cached.projector.snapshot();
    }

    const projector = createBackchatTurnProjector();
    for (const event of events) projector.apply(event);
    this.#turnProjectionCache.set(turn.id, {
      projector,
      applied: events.length,
      first: events[0],
      last: events.at(-1),
    });
    return projector.snapshot();
  };

  #deleteTurn(turnId: string): void {
    this.#turnProjectionCache.delete(turnId);
    this.#turns.delete(turnId);
  }

  subagentsFor(parentSessionId: string): SubagentActivity[] {
    return [...(this.#subagentsByParent.get(parentSessionId) ?? [])].sort(
      (a, b) => a.startedAt - b.startedAt,
    );
  }

  openmaEventsFor(sessionId: string): readonly OpenMAEvent[] {
    const log = this.#openmaEventsBySession.get(sessionId);
    if (!log) return EMPTY_OPENMA_EVENTS;
    log.eventsView ??= log.events.slice();
    return log.eventsView;
  }

  /** Read-only and identity-stable until a WorkItem changes. Correlated
   *  evidence (vendor/raw/monitor events) carries a work_item_id but is not a
   *  lifecycle edge; the reducer only consumes `work_item.*` events. */
  workItemsFor(sessionId: string): WorkItemSnapshot[] {
    const log = this.#openmaEventsBySession.get(sessionId);
    if (!log) return [];
    const registry = log.workItems.snapshot();
    if (log.workItemsView?.registry !== registry) {
      log.workItemsView = { registry, items: [...registry.items.values()] };
    }
    return log.workItemsView.items;
  }

  #ingestOpenMAEvent(
    event: OpenMAEvent,
    options: { persist?: boolean } = {},
  ): boolean {
    let log = this.#openmaEventsBySession.get(event.session_id);
    if (!log) {
      log = createOpenMAEventLog();
      this.#openmaEventsBySession.set(event.session_id, log);
    }
    if (log.ids.has(event.event_id)) return false;
    log.ids.add(event.event_id);
    log.events.push(event);
    log.eventsView = undefined;
    log.workItems.apply(event);
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

  #modelAuthRecovery(session: SessionRow, options: AcpSessionConfigOption[]): Partial<SessionRow> {
    const model = (values: AcpSessionConfigOption[] | undefined) => values?.find(option => option.category === "model" || option.id === "model")?.currentValue;
    const before = model(session.configOptions);
    const after = model(options);
    if (!session.authRequired || !before || !after || before === after) return {};
    return {authRequired: false, authRetryAllowed: true,
      auth: {...session.auth, status: "unknown", message: "Model changed; retry to verify its credentials."}};
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
      const auth = canonicalSessionAuth(data.auth);
      this.#mutateSession(event.session_id, (session) => ({
        ...session,
        ...(auth ? { auth, authRequired: auth.status === "needs-auth" } : {}),
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
        forkSupport: forkSupportFromWire(data.fork_support) ?? session.forkSupport,
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
          ? withoutAuthSlashCommands(data.commands as AcpAvailableCommand[])
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
        // I1/I3: provider activity cannot resurrect a prompt that already
        // resolved. Unowned/session-level snapshots remain observable.
        status: event.turn_id && this.#turns.has(event.turn_id)
          && this.#turns.get(event.turn_id)!.status !== "running"
          ? session.status : "running",
        agentThreadStatus: threadStatus ?? session.agentThreadStatus,
        providerQueueDepth:
          providerQueueDepth ?? session.providerQueueDepth,
      }));
      // A bare "Reconnecting... 2/5" is not actionable; the canonical event
      // carries the provider's own detail when there is one.
      const providerNotice =
        typeof data.message === "string" && data.message.trim()
          ? data.message.trim()
          : providerError && typeof providerError.message === "string"
            ? providerError.message
            : undefined;
      if (providerNotice) {
        this.#showNotice(event.session_id, providerNotice, "warning");
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
        // I1: idle is a provider level, not the response to session/prompt.
        // In particular an old idle must not end a newer unresolved prompt.
        status: session.activeTurnId
          && this.#turns.get(session.activeTurnId)?.status === "running"
          ? "running" : "ready",
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
      const agentId = typeof data.agent_id === "string"
        ? data.agent_id
        : this.#sessions.get(event.session_id)?.agent_id ?? event.source.harness;
      const errorDetails = sessionErrorDetails(data.error_details);
      const auth = canonicalSessionAuth(data.auth);
      // Out-of-band provider failures arrive without a turn id. The session's
      // active turn is the one that failed, and it has to settle so the chat
      // stops showing a running turn.
      const settleTurnId =
        event.turn_id || this.#sessions.get(event.session_id)?.activeTurnId;
      if (
        data.code === "auth_required"
        || auth?.status === "needs-auth"
        || isAuthenticationRequiredError(errorDetails, agentId)
        || isAuthenticationFailureMessage(message)
      ) {
        this.apply({
          type: "session.error",
          session_id: event.session_id,
          message,
          code: "auth_required",
          agent_id: agentId,
          auth,
          error_details: errorDetails,
          openma_event: event,
          ...(settleTurnId ? { turn_id: settleTurnId } : {}),
        });
        return true;
      }
      if (settleTurnId) {
        // A provider failure inside one turn (capacity, bad request, stream
        // drop) ends that turn; the ACP session is still alive and can take
        // the next prompt. Same reducer as the live and auth paths, so replay
        // and live agree and the chat is not locked behind "start a new chat".
        this.apply({
          type: "session.error",
          session_id: event.session_id,
          turn_id: settleTurnId,
          message,
          agent_id: agentId,
          error_details: errorDetails,
          openma_event: event,
        });
        return true;
      }
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
        ...this.#modelAuthRecovery(session, configOptions),
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
    if (harness === "dsh" || harness === "dsh-acp") return "dsh";
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
    // Copy a turn the UI may already hold once per replay pass, then extend
    // the copy in place; copying per event made replay quadratic. SQL is the
    // transcript's source of truth: a held turn (restored from the side
    // workspace snapshot on relaunch) keeps its identity and lifecycle, but
    // its transcript is rebuilt from these rows rather than appended to.
    const owned = previous && this.#replayOwnedTurns.has(previous);
    const turn: Turn = owned ? previous : previous ? {
      ...previous,
      events: [],
      assistantText: "",
      thoughtText: "",
    } : {
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
      turn.assistantText += parsed.text;
      this.#appendStreamEvent(turn, "text", parsed.text, receivedAt, {
        messageId: parsed.messageId,
        phase: parsed.phase,
      });
    } else if (parsed.kind === "thought") {
      turn.thoughtText += parsed.text;
      this.#appendStreamEvent(turn, "thought", parsed.text, receivedAt, {
        messageId: parsed.messageId,
      });
    } else {
      turn.events.push({ payload: event, receivedAt });
    }
    this.#replayOwnedTurns.add(turn);
    this.#turns.set(childTurnId, turn);
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
      projectSelectionExplicit: true,
      projectScope: normalizedCwd ? "project" : "none",
      projectId: undefined,
      additionalDirectories: undefined,
      workspaceId: undefined,
    }));
    this.#emit();
  }

  /** Pick the workspace a draft will start in. Null selects the project's
   *  live source folders. No-op once the session has left draft. */
  setDraftWorkspace(id: string, workspaceId: string | null): void {
    const row = this.#sessions.get(id);
    if (!row || row.status !== "draft") return;
    this.#mutateSession(id, (s) => ({ ...s, workspaceId: workspaceId ?? undefined }));
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

  clearAuthRequired(sessionId: string): void {
    this.#mutateSession(sessionId, (session) => ({
      ...session,
      authRequired: false,
      auth: session.auth
        ? { ...session.auth, status: "configured" }
        : { status: "configured", message: "Authentication completed" },
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
    if (this.#sessions.get(sessionId)?.openma) {
      await this.#updateOpenmaTask(sessionId, { title: trimmed });
      return;
    }
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
  async pin(sessionId: string): Promise<void> {
    const row = this.#sessions.get(sessionId);
    if (!row) return;
    if (row.openma) { await this.#updateOpenmaTask(sessionId, { pinned: true }); return; }
    const at = Date.now();
    this.#mutateSession(sessionId, (s) => ({ ...s, pinnedAt: at }));
    void window.backchat.sessionsPin({ session_id: sessionId });
    this.#emit();
  }

  async unpin(sessionId: string): Promise<void> {
    const row = this.#sessions.get(sessionId);
    if (!row) return;
    if (row.openma) { await this.#updateOpenmaTask(sessionId, { pinned: false }); return; }
    this.#mutateSession(sessionId, (s) => ({ ...s, pinnedAt: undefined }));
    void window.backchat.sessionsUnpin({ session_id: sessionId });
    this.#emit();
  }

  /** Hide a session from the sidebar. Row + events stay in the
   *  in-memory map and on disk so Search can find it and the user
   *  can unarchive later. */
  async archive(sessionId: string): Promise<void> {
    const row = this.#sessions.get(sessionId);
    if (!row) return;
    if (row.openma) { await this.#updateOpenmaTask(sessionId, { archived: true }); return; }
    const at = Date.now();
    this.#mutateSession(sessionId, (s) => ({ ...s, archivedAt: at }));
    void window.backchat.sessionsArchive({ session_id: sessionId });
    this.#emit();
  }

  async unarchive(sessionId: string): Promise<void> {
    const row = this.#sessions.get(sessionId);
    if (row?.openma) { await this.#updateOpenmaTask(sessionId, { archived: false }); return; }
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

  async #updateOpenmaTask(id: string, patch: OpenmaTaskUpdate): Promise<void> {
    const task = await window.backchat.openmaTaskUpdate(id, patch);
    // Workspace switch/logout removes the old row. A delayed reply must not
    // reintroduce it into the newly selected workspace.
    if (this.#sessions.get(id)?.openma) this.seedOpenmaTasks([task]);
  }

  /** Permanently delete a session — drops the SQL row + the on-disk
   *  session dir via IPC, and wipes any local in-memory state so the
   *  UI doesn't keep a ghost row around. Caller is responsible for
   *  the confirm prompt; this method assumes the user has already
   *  said yes. Async because the main-side rm waits on disk I/O. */
  async deletePermanently(sessionId: string): Promise<void> {
    if (this.#sessions.get(sessionId)?.openma) throw new Error("Manage permanent deletion in OpenMA");
    await window.backchat.sessionsDelete({ session_id: sessionId });
    // Pop in-memory bookkeeping. Same shape as session.disposed
    // teardown so any subscriber sees a clean removal.
    if (this.#activeId === sessionId) this.#activeId = null;
    if (this.#sideActiveId === sessionId) this.#sideActiveId = null;
    this.#sessions.delete(sessionId);
    this.#autoOpenedHtmlBySession.delete(sessionId);
    this.#artifactsBySession.delete(sessionId);
    for (const [tid, turn] of this.#turns) {
      if (turn.sessionId === sessionId) this.#deleteTurn(tid);
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
    const prevTabs = this.#sideTabsByMain.get(bucket) ?? [];
    // Subagent tabs are keyed by viewSessionId payload. Reuse the existing
    // rail entry when the caller omitted an id (New-tab list, auto-sync).
    const reusedId =
      requestedId
      ?? (type === "subagent"
        ? prevTabs.find((tab) => tab.type === "subagent" && tab.payload === payload)?.id
        : undefined);
    const id = reusedId || `tab-${Math.random().toString(36).slice(2, 8)}`;
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
      projectId?: string;
      sourceFolders: string[];
      /** Start inside this workspace instead of the live source folders. */
      workspaceId?: string | null;
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
      projectId: project?.projectId?.trim() || undefined,
      additionalDirectories: roots.length > 1 ? roots.slice(1) : undefined,
      workspaceId: project?.workspaceId ?? undefined,
      projectScope: project || normalizedCwd ? "project" : "none",
      projectSelectionExplicit: !project && !normalizedCwd,
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
    const managedParent = parent ? sessionUsesManagedWorkspace(parent) : false;
    const inheritedCwd = (opts?.cwd ?? parent?.cwd ?? "").trim();
    this.#sessions.set(id, {
      id,
      agent_id: opts?.agentId ?? parent?.agent_id ?? "",
      cwd: inheritedCwd,
      acp_session_id: "",
      label: "",
      kind: "side",
      sideKind: "chat",
      status: "draft",
      createdAt: Date.now(),
      chosenCwd: parent && !managedParent
        ? (parent.chosenCwd?.trim() || inheritedCwd || undefined)
        : undefined,
      projectId: managedParent ? undefined : parent?.projectId,
      additionalDirectories: managedParent
        ? undefined
        : parent?.additionalDirectories
          ? [...parent.additionalDirectories]
          : undefined,
      workspaceId: managedParent ? undefined : parent?.workspaceId,
      projectScope: parent ? (managedParent ? "none" : "project") : undefined,
      // A side draft already inherited its parent workspace. Leaving this
      // unset lets the project chip replace a managed folder with the last
      // project the user opened.
      projectSelectionExplicit: !!parent,
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
  newMainForkDraft(parentSessionId: string, point?: AcpForkPoint): string | null {
    const parent = this.#sessions.get(parentSessionId);
    if (
      !parent
      || parent.status === "draft"
      || parent.sideKind === "subagent"
      || !wholeSessionForkEnabled(parent.forkSupport)
      || !parent.acp_session_id
    ) {
      return null;
    }
    if (point && !messageForkEnabled(parent.forkSupport)) return null;
    const id = `fork-${Math.random().toString(36).slice(2, 10)}`;
    const managedParent = sessionUsesManagedWorkspace(parent);
    const projectCwd = (parent.chosenCwd || parent.cwd || "").trim() || undefined;
    this.#sessions.set(id, {
      id,
      agent_id: parent.agent_id,
      cwd: managedParent ? parent.cwd : (projectCwd ?? parent.cwd),
      acp_session_id: "",
      label: "",
      kind: "main",
      status: "draft",
      createdAt: Date.now(),
      chosenCwd: managedParent ? undefined : projectCwd,
      projectId: managedParent ? undefined : parent.projectId,
      additionalDirectories: managedParent
        ? undefined
        : parent.additionalDirectories
          ? [...parent.additionalDirectories]
          : undefined,
      // A project fork stays on the same checkout set. A managed fork must
      // not inherit that private folder as if it were a project.
      workspaceId: managedParent ? undefined : parent.workspaceId,
      projectScope: managedParent ? "none" : "project",
      projectSelectionExplicit: true,
      configOptions: parent.configOptions?.map((option) => ({ ...option })),
      currentModeId: parent.currentModeId,
      availableCommands: parent.availableCommands?.map((command) => ({
        ...command,
      })),
      forkParent: {
        parentSessionId: parent.id,
        parentAcpSessionId: parent.acp_session_id,
        inheritance: "fork",
        ...(point ? { point } : {}),
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
    annotations: PromptAnnotation[] = [],
  ): void {
    const row = this.#sessions.get(sessionId);
    const isSteering =
      !!row?.activeTurnId
      && delivery?.intent === "steer"
      && delivery.effectiveDelivery === "llm_boundary";
    const isQueued = !!row?.activeTurnId && !isSteering;
    const now = Date.now();
    this.#turns.set(turnId, {
      id: turnId,
      sessionId,
      promptText,
      annotations: annotations.length ? annotations : undefined,
      attachments: attachments.length > 0
        ? attachments.map(({ data: _data, ...attachment }) => attachment)
        : undefined,
      sessionReferences: sessionReferences.length > 0
        ? sessionReferences
        : undefined,
      events: [],
      assistantText: "",
      thoughtText: "",
      status: isQueued
        ? "queued"
        : "running",
      clientId: turnId,
      // The bubble is visible immediately. "Working" waits until the host
      // accepts the prompt (the first turn event, or a terminal boundary).
      sendState: isQueued ? undefined : "pending",
      promptIntent: delivery?.intent,
      requestedDelivery: delivery?.requestedDelivery,
      effectiveDelivery: delivery?.effectiveDelivery,
      deliveryDegraded: delivery?.degraded,
      startedAt: now,
    });
    this.#mutateSession(sessionId, (s) => ({
      ...s,
      activeTurnId: s.activeTurnId ?? turnId,
      queuedTurnIds: isQueued
        ? [...(s.queuedTurnIds ?? []), turnId]
        : s.queuedTurnIds,
      status: "running",
      lastUsedAt: Math.max(s.lastUsedAt ?? s.createdAt, now),
    }));
    this.#recordSubagentActivity(sessionId, {
      task: promptText,
      status: "running",
    });
    this.#emit();
  }

  /** I1: session/load or session/resume restores context, not a lost prompt.
   * Only reconcile the history snapshot IDs: a newly sent prompt may race IPC.
   * A surviving main-owned prompt stays running across renderer reloads. */
  reconcileHistoryRuntime(sessionId: string, replayedTurnIds: readonly string[], busy: boolean, activeTurnIds?: readonly string[]): void {
    if (busy && !activeTurnIds) return;
    const activeIds = new Set(activeTurnIds ?? []);
    const ids = new Set(replayedTurnIds);
    for (const turn of this.#turns.values()) {
      if (turn.sessionId !== sessionId || !ids.has(turn.id) || activeIds.has(turn.id) || turn.status !== "running") continue;
      this.#turns.set(turn.id, { ...turn, status: "cancelled", stopReason: "interrupted", endedAt: turn.endedAt ?? turn.startedAt });
    }
    this.#mutateSession(sessionId, session => {
      const active = session.activeTurnId && this.#turns.get(session.activeTurnId);
      if (active && (active.status === "running" || active.status === "queued")) return session;
      return { ...session, activeTurnId: undefined, status: session.status === "running" ? "ready" : session.status };
    });
    this.#emit();
  }

  /** The host's queue snapshot is the authority on what is running. A turn
   *  replayed from SQL whose terminal event never got persisted (a write that
   *  failed with ENOSPC, a crash mid-turn) would otherwise stay "running"
   *  forever. Once the host says it is not active, settle it as interrupted at
   *  its last persisted event. Optimistic sends still awaiting the host's ack
   *  are left alone. */
  #settleOrphanedRunningTurns(
    sessionId: string,
    activeTurnId: string | undefined,
    steeringTurnIds: readonly string[],
  ): void {
    const keep = new Set([activeTurnId, ...steeringTurnIds].filter(Boolean));
    for (const turn of this.#turns.values()) {
      if (turn.sessionId !== sessionId || turn.status !== "running") continue;
      if (keep.has(turn.id) || turn.sendState === "pending") continue;
      this.#turns.set(turn.id, {
        ...turn,
        status: "cancelled",
        stopReason: turn.stopReason ?? "interrupted",
        endedAt: turn.endedAt ?? turn.startedAt,
      });
    }
  }

  #markTurnRunning(turnId: string | undefined): void {
    if (!turnId) return;
    const turn = this.#turns.get(turnId);
    if (turn?.status === "queued") {
      this.#turns.set(turnId, {
        ...turn,
        status: "running",
        sendState: turn.sendState === "failed" ? "failed" : "pending",
      });
    }
  }

  /** Bind a host turn id onto the optimistic bubble that used `clientId`. */
  #adoptOptimisticTurn(
    sessionId: string,
    clientId: string,
    hostTurnId: string,
    text: string,
  ): void {
    const optimistic = [...this.#turns.values()].find((turn) =>
      turn.clientId === clientId && (turn.sessionId === sessionId || turn.id === clientId),
    );
    if (!optimistic) {
      this.#acceptOptimisticSend(hostTurnId);
      return;
    }
    if (optimistic.id === hostTurnId && optimistic.sessionId === sessionId) {
      this.#turns.set(hostTurnId, {
        ...optimistic,
        promptText: text || optimistic.promptText,
        sendState: undefined,
        sendError: undefined,
      });
      return;
    }
    const host = this.#turns.get(hostTurnId);
    this.#deleteTurn(optimistic.id);
    this.#turns.set(hostTurnId, host
      ? {
          ...host,
          sessionId,
          clientId,
          promptText: text || optimistic.promptText || host.promptText,
          attachments: host.attachments ?? optimistic.attachments,
          sendState: undefined,
          sendError: undefined,
        }
      : {
          ...optimistic,
          id: hostTurnId,
          sessionId,
          clientId,
          promptText: text || optimistic.promptText,
          sendState: undefined,
          sendError: undefined,
        });
    if (this.#sessions.has(sessionId)) {
      this.#mutateSession(sessionId, (session) => ({
        ...session,
        activeTurnId: session.activeTurnId === optimistic.id ? hostTurnId : session.activeTurnId,
        queuedTurnIds: session.queuedTurnIds?.map((id) => id === optimistic.id ? hostTurnId : id),
      }));
    }
    if (optimistic.sessionId !== sessionId && this.#sessions.has(optimistic.sessionId)) {
      this.#mutateSession(optimistic.sessionId, (session) => ({
        ...session,
        activeTurnId: session.activeTurnId === optimistic.id ? undefined : session.activeTurnId,
        status: session.activeTurnId === optimistic.id ? "ready" : session.status,
      }));
    }
  }

  /** A project page binds a session the sidebar does not activate. */
  ensureBoundSession(input: {
    id: string;
    agentId: string;
    cwd: string;
    label: string;
    projectId?: string;
  }): void {
    if (this.#sessions.has(input.id)) return;
    this.#sessions.set(input.id, {
      id: input.id,
      agent_id: input.agentId,
      cwd: input.cwd,
      acp_session_id: "",
      label: input.label,
      status: "ready",
      createdAt: Date.now(),
      projectId: input.projectId,
      listHidden: true,
    });
    this.#emit();
  }

  /** Move a placeholder coordinator session onto the host session id. */
  rebindSession(fromId: string, toId: string): void {
    if (!fromId || fromId === toId) return;
    const from = this.#sessions.get(fromId);
    const hasTurns = [...this.#turns.values()].some((turn) => turn.sessionId === fromId);
    if (!from && !hasTurns) return;
    if (from && !this.#sessions.has(toId)) {
      this.#sessions.set(toId, { ...from, id: toId });
    }
    if (from) this.#sessions.delete(fromId);
    for (const [id, turn] of this.#turns) {
      if (turn.sessionId === fromId) {
        this.#turns.set(id, { ...turn, sessionId: toId });
      }
    }
    this.#emit();
  }

  /** The host has the prompt. The running indicator may take over from "Sending…". */
  #acceptOptimisticSend(turnId: string | undefined): void {
    if (!turnId) return;
    const turn = this.#turns.get(turnId);
    if (turn?.sendState !== "pending") return;
    this.#turns.set(turnId, {
      ...turn,
      sendState: undefined,
      sendError: undefined,
    });
  }

  /** The send never reached an accepted prompt. Keep the bubble and offer retry. */
  failSend(turnId: string, message: string): void {
    const turn = this.#turns.get(turnId);
    if (!turn) return;
    this.#turns.set(turnId, {
      ...turn,
      status: "error",
      errorMessage: message,
      sendState: "failed",
      sendError: message,
      endedAt: Date.now(),
    });
    this.#advanceAfterTurn(turn.sessionId, turnId);
    this.#emit();
  }

  /** Put a failed send back into the pending bubble and resubmit that same turn. */
  reopenSend(turnId: string): void {
    const turn = this.#turns.get(turnId);
    if (!turn) return;
    this.#turns.set(turnId, {
      ...turn,
      status: "running",
      errorMessage: undefined,
      sendState: "pending",
      sendError: undefined,
      endedAt: undefined,
    });
    this.#mutateSession(turn.sessionId, (session) => ({
      ...session,
      activeTurnId: turnId,
      status: "running",
      lastError: undefined,
    }));
    this.#emit();
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

  /**
   * Clear the sticky provider explanation from the failed turns of a session.
   *
   * A terminal Codex provider error (credentials gone, quota spent, reconnects
   * exhausted) cannot recover on its own, so its copy owns the failed turn in
   * the feed and stays there while the user retries — including while the new
   * attempt is still in flight. Only a successful later turn in the same
   * session clears it ("成功了就清掉"). Recovering the session itself (signing
   * in again, reconnecting) does not: the feed still has to explain what
   * happened.
   *
   * All preceding sticky provider rows in the session are cleared at once, so
   * the feed never keeps a stale explanation next to a healthy conversation.
   * Ordinary failures — the provider rejected the request, the disk is full —
   * are not provider-sticky copy and are left untouched.
   *
   * The turn is mutated in place as well as replaced with a fresh object:
   * replay keeps its own id→turn map while rebuilding history, so a clear has
   * to reach those references too, while React needs the new object identity.
   */
  #clearStickyProviderFeedErrors(
    sessionId: string,
    completedTurnId: string,
    completedStartedAt: number,
  ): number {
    let cleared = 0;
    for (const [id, turn] of this.#turns) {
      if (turn.sessionId !== sessionId) continue;
      if (id === completedTurnId) continue;
      // Only the turns that came before the successful one. A later failure
      // is its own fact and must not be erased by an earlier retry.
      if (turn.startedAt > completedStartedAt) continue;
      if (turn.status !== "error") continue;
      if (!isStickyProviderErrorMessage(turn.errorMessage)) continue;
      turn.errorMessage = undefined;
      this.#turns.set(id, { ...turn });
      cleared++;
    }
    return cleared;
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
        update.childId ?? context?.childId ?? `${update.provider}:${update.parentToolUseId}`;
      const lifecycle: NativeAgentUpdate = {
        provider: update.provider,
        operation: update.provider === "dsh" ? "subagent_spawn" : "claude_agent",
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
        next.assistantText += update.text;
        this.#appendStreamEvent(next, "text", update.text, now, {
          messageId: update.messageId,
        });
      } else if (update.kind === "thought" && update.text) {
        next.thoughtText += update.text;
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

  #settleBackgroundWorkItemsForTurn(sessionId: string, turn: Turn): void {
    const toolCallIds = new Set(
      turn.events.flatMap(({ payload }) => {
        const parsed = parseAcpEvent(payload);
        return parsed.kind === "tool_call" ? [parsed.tool.toolCallId] : [];
      }),
    );
    const events = this.#openmaEventsBySession.get(sessionId)?.events ?? [];
    const items = new Map(
      this.workItemsFor(sessionId).map((item) => [item.id, item]),
    );
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
        asyncLaunched: update.asyncLaunched ?? existingContext?.asyncLaunched,
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

    const hadAssistant = !!previousTurn?.assistantText;
    const seededAssistant =
      previousTurn?.assistantText || activity.native?.result || "";
    const seededEvents = [...(previousTurn?.events ?? [])];
    if (
      !hadAssistant
      && activity.native?.result
      && seededAssistant === activity.native.result
    ) {
      this.#resultSeededTurns.add(turnId);
    }
    // Keep timeline + accumulator aligned when the only answer is the
    // structured native result (no stream chunks yet).
    if (
      seededAssistant
      && seededEvents.length === 0
      && !hadAssistant
      && activity.native?.result
    ) {
      const seed: Turn = {
        id: turnId,
        sessionId: viewSessionId,
        promptText: activity.task,
        events: [],
        assistantText: seededAssistant,
        thoughtText: "",
        status: turnStatus,
        errorMessage: activity.errorMessage,
        startedAt: previousTurn?.startedAt ?? activity.startedAt,
        endedAt:
          turnStatus === "running"
            ? undefined
            : previousTurn?.endedAt ?? activity.updatedAt,
      };
      this.#appendStreamEvent(
        seed,
        "text",
        seededAssistant,
        previousTurn?.startedAt ?? activity.startedAt,
      );
      this.#turns.set(turnId, seed);
    } else {
      this.#turns.set(turnId, {
        id: turnId,
        sessionId: viewSessionId,
        promptText: activity.task,
        events: seededEvents,
        assistantText: seededAssistant,
        thoughtText: previousTurn?.thoughtText ?? "",
        status: turnStatus,
        errorMessage: activity.errorMessage,
        startedAt: previousTurn?.startedAt ?? activity.startedAt,
        endedAt:
          turnStatus === "running"
            ? undefined
            : previousTurn?.endedAt ?? activity.updatedAt,
      });
    }

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
      workspace_id?: string | null;
      external_client?: string | null;
      parent_session_id?: string | null;
      fork_kind?: "session" | "message" | null;
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
          workspaceId: r.workspace_id ?? s.workspaceId,
          externalClient: r.external_client ?? s.externalClient,
          parentSessionId: r.parent_session_id || s.parentSessionId,
          forkKind: r.fork_kind === "session" || r.fork_kind === "message"
            ? r.fork_kind
            : s.forkKind,
          acp_session_id: r.acp_session_id || s.acp_session_id,
          label: r.title || s.label,
          titleManuallySet: r.title_manually_set === 1 || s.titleManuallySet,
          projectScope: s.projectScope,
          kind: this.#isPairMember(r.id) ? "pair" : s.kind,
          createdAt: r.created_at || s.createdAt,
          lastUsedAt: r.last_used_at || r.created_at || s.lastUsedAt || s.createdAt,
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
        workspaceId: r.workspace_id ?? undefined,
        externalClient: r.external_client || undefined,
        parentSessionId: r.parent_session_id || undefined,
        forkKind: r.fork_kind === "session" || r.fork_kind === "message"
          ? r.fork_kind
          : undefined,
        acp_session_id: r.acp_session_id,
        label: r.title || "New chat",
        titleManuallySet: r.title_manually_set === 1,
        kind: this.#isPairMember(r.id) ? "pair" : undefined,
        status: "ready",
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at || r.created_at,
        pinnedAt: r.pinned_at ?? undefined,
        archivedAt: r.archived_at ?? undefined,
      });
    }
    this.#emit();
  }

  /** Window bookkeeping for a session opened through replayHistoryWindow.
   *  Undefined when the session was replayed in full (or not at all). */
  historyWindowFor(sessionId: string): HistoryWindowInfo | undefined {
    const state = this.#history.get(sessionId);
    if (!state) return undefined;
    return {
      oldestSeq: state.oldestSeq,
      hasMore: state.hasMore,
      loading: state.loading,
    };
  }

  isHistoryPending(sessionId: string): boolean {
    return this.#historyPending.has(sessionId);
  }

  setHistoryPending(sessionId: string, pending: boolean): void {
    if (this.#historyPending.has(sessionId) === pending) return;
    if (pending) this.#historyPending.add(sessionId);
    else this.#historyPending.delete(sessionId);
    this.#emit();
  }

  setHistoryLoading(sessionId: string, loading: boolean): void {
    const state = this.#history.get(sessionId);
    if (!state || state.loading === loading) return;
    state.loading = loading;
    this.#emit();
  }

  /** Open a session from the newest rows only. Main aligns the window to a
   *  turn opener; a prompt-less head turn only appears for rows that precede
   *  the first prompt of a log that still has older rows. */
  replayHistoryWindow(
    sessionId: string,
    rows: HistoryRow[],
    opts: { hasMore: boolean },
  ): void {
    this.#historyPending.delete(sessionId);
    if (!this.#shouldMaterializeHistoryFromSql(sessionId)) { this.#emit(); return; }
    this.#clearMaterializableTurns(sessionId);
    const agentLifecycle = this.#replayRows(sessionId, rows, {
      partialHead: opts.hasMore,
      notices: true,
    });
    this.#history.set(sessionId, {
      oldestSeq: rows[0]?.seq,
      hasMore: opts.hasMore,
      loading: false,
      agentLifecycle,
    });
    if (!opts.hasMore) this.#pruneNonCanonicalSubagents(sessionId, agentLifecycle);
    this.#emit();
  }

  /** Page older rows in front of the current window. A page holds whole
   *  turns, so only the new rows are replayed: existing turn objects (and
   *  their cached projections) are kept, which keeps React work proportional
   *  to the page instead of the window. Session-level projections are
   *  "latest wins" and keep the state the newer rows already produced. */
  prependHistory(
    sessionId: string,
    olderRows: HistoryRow[],
    opts: { hasMore: boolean },
  ): void {
    const state = this.#history.get(sessionId);
    if (!state) return;
    state.loading = false;
    state.hasMore = opts.hasMore;
    const oldest = state.oldestSeq;
    const rows = olderRows.filter((row) => oldest === undefined || row.seq < oldest);
    if (rows.length > 0) {
      state.oldestSeq = rows[0]!.seq;
      state.agentLifecycle = [
        ...this.#prependReplay(sessionId, rows, state.hasMore),
        ...state.agentLifecycle,
      ];
    }
    if (!state.hasMore) this.#pruneNonCanonicalSubagents(sessionId, state.agentLifecycle);
    this.#emit();
  }

  #prependReplay(
    sessionId: string,
    rows: HistoryRow[],
    partialHead: boolean,
  ): NativeAgentLifecycleFact[] {
    // Detach the newer turns (parent and subagent transcript turns) so the
    // replay registers the older ones first; Map order reads oldest → newest.
    const activitiesBefore = this.#subagentsByParent.get(sessionId);
    const childTurnIds = new Set(
      (activitiesBefore ?? []).map((activity) => `${activity.viewSessionId}:turn`),
    );
    const newer: Turn[] = [];
    const newerChildren = new Map<string, Turn>();
    for (const [id, turn] of this.#turns) {
      if (turn.sessionId === sessionId) newer.push(turn);
      else if (childTurnIds.has(id)) newerChildren.set(id, turn);
      else continue;
      this.#turns.delete(id);
    }
    const sessionBefore = this.#sessions.get(sessionId);
    const agentLifecycle = this.#replayRows(sessionId, rows, {
      partialHead,
      notices: false,
    });
    if (sessionBefore) this.#sessions.set(sessionId, sessionBefore);
    // Pages are disjoint in seq, so a turn id present on both sides is one
    // turn split by the boundary: the older page holds its start, the newer
    // rows its continuation (a queueing harness can write a turn's tail,
    // terminal included, after later prompts). Join them by id, in the older
    // turn's position. The id-less legacy head continues the newest older turn.
    const headId = `replay-${sessionId}-head`;
    let owner: Turn | undefined;
    for (const turn of this.#turns.values()) {
      if (turn.sessionId === sessionId) owner = turn;
    }
    for (const turn of newer) {
      const older = this.#turns.get(turn.id);
      if (older && older !== turn) {
        this.#turns.set(turn.id, foldHeadIntoTurn(older, turn));
        this.#turnProjectionCache.delete(turn.id);
      } else if (turn.id === headId && owner && owner.id !== headId) {
        this.#turns.set(owner.id, foldHeadIntoTurn(owner, turn));
        this.#turnProjectionCache.delete(headId);
        this.#turnProjectionCache.delete(owner.id);
      } else {
        this.#turns.set(turn.id, turn);
      }
    }
    for (const [id, turn] of newerChildren) {
      const older = this.#turns.get(id);
      this.#turns.delete(id);
      this.#turns.set(id, older ? concatChildTranscriptTurns(older, turn) : turn);
    }
    // Activities first seen in the older page are added; the ones the newer
    // rows already know keep their newer state.
    if (activitiesBefore) {
      const known = new Set(activitiesBefore.map((activity) => activity.childSessionId));
      const discovered = (this.#subagentsByParent.get(sessionId) ?? [])
        .filter((activity) => !known.has(activity.childSessionId));
      this.#subagentsByParent.set(sessionId, [...discovered, ...activitiesBefore]);
    }
    return agentLifecycle;
  }

  #hasSessionTurns(sessionId: string): boolean {
    for (const turn of this.#turns.values()) {
      if (turn.sessionId === sessionId) return true;
    }
    return false;
  }

  /** Live turns win over SQL replay. Placeholder replay heads (and inherited
   *  parent rows) must not block materializing persisted user prompts — e.g.
   *  a CLI-started thread whose GUI resume races ahead of history fetch. */
  #shouldMaterializeHistoryFromSql(sessionId: string): boolean {
    const replayPrefix = `replay-${sessionId}-`;
    for (const turn of this.#turns.values()) {
      if (turn.sessionId !== sessionId || turn.inherited) continue;
      if (turn.promptText?.trim()) return false;
      if (
        turn.id.startsWith(replayPrefix)
        || turn.id.startsWith("inherited-")
      ) {
        continue;
      }
      // Resume can register a running turn before SQL history lands; still
      // materialize the persisted user prompt when the live row is empty.
      if (turn.status === "running" && !turn.promptText?.trim()) continue;
      return false;
    }
    return true;
  }

  /** Replay persisted events into a turn structure so the chat view can
   *  render history. `events` rows come from sessions.loadHistory; we
   *  collapse them into one Turn per user_prompt boundary so the visual
   *  matches a live conversation. */
  replayHistory(sessionId: string, rows: HistoryRow[]): void {
    // Skip replay entirely if this session already has turns in the
    // store. The in-memory turns from the live session are authoritative
    // — only first-time mounts (after a renderer reload) actually need
    // to materialize SQL history into turn structures. Without this
    // guard, wiping and re-creating turns from SQL kills the user's
    // currently-streaming bubble.
    this.#historyPending.delete(sessionId);
    if (!this.#shouldMaterializeHistoryFromSql(sessionId)) { this.#emit(); return; }
    this.#clearMaterializableTurns(sessionId);
    this.#history.delete(sessionId);
    const agentLifecycle = this.#replayRows(sessionId, rows, {
      partialHead: false,
      notices: true,
    });
    this.#pruneNonCanonicalSubagents(sessionId, agentLifecycle);
    this.#emit();
  }

  #clearMaterializableTurns(sessionId: string): void {
    for (const [id, turn] of this.#turns) {
      if (turn.sessionId === sessionId && !turn.inherited) {
        this.#deleteTurn(id);
      }
    }
  }

  /** Ownerless late tool patches belong only to a unique existing call, never
   * to a guessed active turn or a new prompt (I1/I11). */
  #existingToolOwner(sessionId: string, payload: unknown): Turn | undefined {
    const parsed = parseAcpEvent(payload);
    if (parsed.kind !== "tool_call") return undefined;
    const matches = [...this.#turns.values()].filter(turn => turn.sessionId === sessionId
      && this.projectTurn(turn).tools.some(tool => tool.toolCallId === parsed.tool.toolCallId));
    return matches.length === 1 ? matches[0] : undefined;
  }

  #replayRows(
    sessionId: string,
    rows: HistoryRow[],
    opts: { partialHead: boolean; notices: boolean },
  ): NativeAgentLifecycleFact[] {
    this.#replayOwnedTurns = new WeakSet();
    const notify = (message: string) => {
      if (opts.notices) this.#showNotice(sessionId, message, "warning");
    };
    // A window can hold rows of a turn whose prompt is in an older page:
    // the window opened mid-turn, or a queueing harness wrote the turn's tail
    // after later prompts. Keep those rows under the turn's own id as a
    // prompt-less continuation; when the older page lands, prependHistory
    // joins the two by id. Rows with no turn id share one legacy head.
    const makeHead = (ts: number, turnId?: string): Turn => ({
      id: turnId ?? `replay-${sessionId}-head`,
      sessionId,
      promptText: "",
      events: [],
      assistantText: "",
      thoughtText: "",
      status: "running",
      startedAt: ts,
      endedAt: ts,
    });

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
    // Older builds could persist ordinary root traffic as RFD evidence while
    // session.ready was still in flight. Only suppress canonical rows when
    // structured child ownership (or an RFD-only update) proves duplication.
    const announcedChildren = new Set(prepared.flatMap(({ canonical }) => {
      const vendor = wireRecord(canonical?.data);
      const raw = wireRecord(vendor.data);
      const update = raw.update ? wireRecord(raw.update) : raw;
      return canonical?.type === "vendor.event" && vendor.namespace === "subagent_sessions"
        && update.sessionUpdate === "subagent_update" && typeof update.sessionId === "string"
        ? [update.sessionId] : [];
    }));
    const rfdRawEvidence = new Set(prepared.flatMap(({ canonical }) => {
      const vendor = wireRecord(canonical?.data);
      const raw = wireRecord(vendor.data);
      const update = raw.update ? wireRecord(raw.update) : raw;
      const scoped = update.sessionUpdate === "subagent_update"
        || update.sessionUpdate === "session_message"
        || update.sessionUpdate === "session_message_chunk"
        || announcedChildren.has(wireSessionId(vendor.data) ?? "");
      return canonical?.type === "vendor.event" && vendor.namespace === "subagent_sessions" && scoped
        ? [persistedEventFingerprint(vendor.data)] : [];
    }));
    const canonicalRawEvidence = new Set(
      prepared
        .map(({ canonical }) => canonical?.raw?.payload)
        .filter((payload): payload is unknown => payload !== undefined)
        .map(persistedEventFingerprint),
    );
    const richerCanonicalByRawOccurrence = new Map<string, OpenMAEvent>();
    const agentLifecycle: NativeAgentLifecycleFact[] = [];
    for (const { canonical } of prepared) {
      if (canonical?.work_item_id) {
        const canonicalData = isPlainRecord(canonical.data)
          ? canonical.data
          : {};
        if (
          canonical.type === "work_item.started"
          && canonicalData.kind === "agent"
        ) {
          agentLifecycle.push({ type: "started", id: canonical.work_item_id });
        } else if (
          canonical.type === "work_item.reidentified"
          && typeof canonicalData.previous_work_item_id === "string"
        ) {
          agentLifecycle.push({
            type: "reidentified",
            id: canonical.work_item_id,
            previousId: canonicalData.previous_work_item_id,
          });
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
    const turnsByCanonicalId = new Map<string, Turn>();
    // Successful terminals are applied after the whole log is rebuilt: the
    // canonical id map is written back over the store at the end, so clearing
    // a sticky provider explanation mid-loop could be overwritten by the
    // pre-clear turn object.
    const completedTurns: Array<{ id: string; startedAt: number }> = [];
    // A legacy `user_prompt` row (pre-canonical histories) opens a turn but
    // carries no turn id. The canonical rows that follow it carry the host
    // turn id, so the first unknown id claims that turn instead of being
    // dropped for having no canonical user.message.
    let unclaimedLegacyTurn: Turn | null = null;
    for (const { row: r, data, canonical } of prepared) {
      if (canonical) {
        if (canonical.raw?.payload && rfdRawEvidence.has(persistedEventFingerprint(canonical.raw.payload))) continue;
        const vendor = wireRecord(canonical.data);
        if (canonical.type === "vendor.event" && vendor.namespace === "subagent_sessions") {
          this.#ingestOpenMAEvent(canonical);
          if (!this.#rfdAppliedEvents.has(canonical.event_id)) {
            this.#rfdAppliedEvents.add(canonical.event_id);
            this.#applySubagentSession(sessionId, vendor.data, canonical.turn_id);
          }
          continue;
        }
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
            const activeTurnId =
              typeof input.active_turn_id === "string"
                ? input.active_turn_id
                : undefined;
            if (inputKind === "steering" && input.outcome === "injected") {
              let activeTurn =
                (activeTurnId ? turnsByCanonicalId.get(activeTurnId) : undefined)
                ?? (activeTurnId ? this.#turns.get(activeTurnId) : undefined);
              if (!activeTurn && opts.partialHead) {
                activeTurn = makeHead(r.ts, activeTurnId);
                if (activeTurnId) {
                  turnsByCanonicalId.set(activeTurnId, activeTurn);
                }
                this.#turns.set(activeTurn.id, activeTurn);
              }
              if (activeTurn) {
                activeTurn.events.push({ payload: canonical, receivedAt: r.ts });
                activeTurn.endedAt = Math.max(activeTurn.endedAt ?? activeTurn.startedAt, r.ts);
              }
              continue;
            }
            const tid = canonical.turn_id ?? `replay-${sessionId}-${r.seq}`;
            const next: Turn = {
              id: tid,
              sessionId,
              clientId: typeof input.client_id === "string" && input.client_id
                ? input.client_id
                : undefined,
              promptText: typeof input.text === "string" ? input.text : "",
              annotations: Array.isArray(input.annotations) ? input.annotations as PromptAnnotation[] : undefined,
              attachments: Array.isArray(input.attachments)
                ? input.attachments as PromptAttachment[]
                : undefined,
              sessionReferences: Array.isArray(input.session_references)
                ? input.session_references as PromptSessionReference[]
                : undefined,
              events: [],
              assistantText: "",
              thoughtText: "",
              status: "running",
              startedAt: r.ts,
              endedAt: r.ts,
            };
            if (inputKind === "steering") {
              next.events.push({ payload: canonical, receivedAt: r.ts });
            }
            if (canonical.turn_id) turnsByCanonicalId.set(canonical.turn_id, next);
            this.#turns.set(tid, next);
            current = next;
            unclaimedLegacyTurn = null;
          }
          continue;
        }

        const parsedCanonical = parseAcpEvent(canonical);
        // I1/I11: session-scoped text has no prompt owner. Retain it as a
        // notice, never a synthetic running turn (live/replay share this rule).
        if (!canonical.turn_id && parsedCanonical.kind === "text") {
          if (parsedCanonical.text.trim()) notify(parsedCanonical.text.trim());
          continue;
        }
        let turn = canonical.turn_id
          ? turnsByCanonicalId.get(canonical.turn_id)
            ?? this.#turns.get(canonical.turn_id)
          : this.#existingToolOwner(sessionId, canonical);
        if (!turn && canonical.turn_id && unclaimedLegacyTurn) {
          turn = unclaimedLegacyTurn;
          turnsByCanonicalId.set(canonical.turn_id, turn);
          unclaimedLegacyTurn = null;
        }
        // A canonical row with no turn_id is session-scoped (background
        // processes, work items): it has no turn to continue, so it must not
        // conjure a prompt-less head that sits "running" forever.
        if (!turn && opts.partialHead && canonical.turn_id) {
          turn = makeHead(r.ts, canonical.turn_id);
          if (canonical.turn_id) turnsByCanonicalId.set(canonical.turn_id, turn);
          this.#turns.set(turn.id, turn);
        }
        if (!turn) continue;
        turn.endedAt = Math.max(turn.endedAt ?? turn.startedAt, r.ts);
        if (canonical.type === "turn.completed") {
          turn.status = "complete";
          // The stop reason is on disk and was being dropped, so a turn cut off
          // at a limit or declined came back from a restart looking like an
          // ordinary finished answer — the live view said one thing and the
          // replayed view another about the same turn.
          const completedData = isPlainRecord(canonical.data)
            ? canonical.data
            : undefined;
          if (typeof completedData?.["stop_reason"] === "string") {
            turn.stopReason = completedData["stop_reason"];
          }
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
          // The live path clears a terminal provider failure from the feed
          // when a later turn succeeds; replay has to agree, or a restart
          // would bring the stale explanation back. Do it after the rebuild
          // below, once the final turn objects are in the store.
          completedTurns.push({ id: turn.id, startedAt: turn.startedAt });
          continue;
        }
        if (canonical.type === "turn.cancelled") {
          turn.status = "cancelled";
          continue;
        }
        if (canonical.type === "turn.failed") {
          turn.status = "error";
          const errorData = isPlainRecord(canonical.data)
            ? canonical.data
            : undefined;
          turn.errorMessage =
            typeof errorData?.message === "string"
              ? errorData.message
              : turn.errorMessage;
          continue;
        }
        if (canonical.type === "session.error" && canonical.turn_id) {
          const interruption = isRestartableAgentInterruption(this.#sessions.get(sessionId)?.agent_id ?? canonical.source.harness, isPlainRecord(canonical.data) ? canonical.data.error_details : undefined);
          if (interruption) {
            turn.status = "cancelled";
            turn.stopReason = "interrupted";
            turn.errorMessage = undefined;
            continue;
          }
          turn.status = "error";
          const errorData = isPlainRecord(canonical.data)
            ? canonical.data
            : undefined;
          turn.errorMessage =
            typeof errorData?.message === "string"
              ? errorData.message
              : turn.errorMessage;
          continue;
        }

        // Content and structural transcript facts are kept in the existing
        // Turn event list. The reducer already understands the canonical
        // envelope, so replay does not need to reconstruct an ACP payload.
        if (parsedCanonical.kind === "text") {
          const split = splitAcpSystemNoticeText(parsedCanonical.text);
          if (split.notice) {
            notify(split.notice);
          }
          turn.assistantText += split.transcript;
          if (split.transcript) {
            this.#appendStreamEvent(turn, "text", split.transcript, r.ts, {
              messageId: parsedCanonical.messageId,
              phase: parsedCanonical.phase,
            });
          }
        } else if (parsedCanonical.kind === "thought") {
          turn.thoughtText += parsedCanonical.text;
          this.#appendStreamEvent(turn, "thought", parsedCanonical.text, r.ts, {
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
          || (canonical.type === "raw.event" && canonical.data.method === "session/update" &&
            (canonical.data.event_type === "compaction_update" || canonical.data.event_type === "compaction_summary_chunk"))
        ) {
          turn.events.push({ payload: canonical, receivedAt: r.ts });
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
        const tid = `replay-${sessionId}-${r.seq}`;
        const promptRecord = data as { text?: string; client_id?: string };
        current = {
          id: tid,
          sessionId,
          clientId: typeof promptRecord.client_id === "string" && promptRecord.client_id
            ? promptRecord.client_id
            : undefined,
          promptText: promptRecord.text ?? "",
          annotations: (data as { annotations?: PromptAnnotation[] })?.annotations,
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
        unclaimedLegacyTurn = current;
      } else {
        if (!current && opts.partialHead) current = makeHead(r.ts);
        if (!current) continue;
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
            notify(split.notice);
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
              notify(split.notice);
            }
            current.assistantText += split.transcript;
            if (split.transcript) {
              this.#appendStreamEvent(current, "text", split.transcript, r.ts, {
                messageId: parsed.messageId,
                phase: parsed.phase,
              });
            }
          } else if (parsed.kind === "thought") {
            current.thoughtText += parsed.text;
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
    for (const turn of turnsByCanonicalId.values()) this.#turns.set(turn.id, turn);
    for (const completed of completedTurns) {
      this.#clearStickyProviderFeedErrors(
        sessionId,
        completed.id,
        completed.startedAt,
      );
    }
    return agentLifecycle;
  }

  /** Side-workspace snapshots are restored before SQL history. Native
   *  subagent tabs are projections of canonical lifecycle events, so once the
   *  whole log has been replayed, discard snapshot-only children that are
   *  absent from it. Otherwise each reload accumulates another random view
   *  id and leaves stale "Running / Thinking" tabs beside a terminal child
   *  that has already completed. A partial window cannot prove staleness —
   *  lifecycle rows may live in pages that are not loaded yet. */
  #pruneNonCanonicalSubagents(
    sessionId: string,
    agentLifecycle: readonly NativeAgentLifecycleFact[],
  ): void {
    const canonicalNativeAgentIds = canonicalNativeAgentIdsOf(agentLifecycle);
    if (canonicalNativeAgentIds.size === 0) return;
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
        if (turn.sessionId === viewSessionId) this.#deleteTurn(turnId);
      }
    }
    this.#syncVisibleSideSession(sessionId);
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
        const auth = ev.auth ?? canonicalSessionAuth(canonicalStart?.auth);
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
            parentSessionId: s.parentSessionId
              ?? s.forkParent?.parentSessionId
              ?? (s.sideParent?.inheritance === "fork"
                ? s.sideParent.parentSessionId
                : undefined),
            forkKind: s.forkKind
              ?? (s.forkParent
                ? (s.forkParent.point ? "message" : "session")
                : s.sideParent?.inheritance === "fork"
                  ? (s.sideParent.point ? "message" : "session")
                  : undefined),
            forkPoint: s.forkPoint ?? s.forkParent?.point ?? s.sideParent?.point,
            forkParent: undefined,
            acp_session_id: ev.acp_session_id,
            agent_id: ev.agent_id,
            cwd: ev.cwd,
            projectId: ev.project_id ?? s.projectId,
            additionalDirectories:
              ev.additional_directories ?? s.additionalDirectories,
            workspaceId: ev.workspace_id === undefined ? s.workspaceId : ev.workspace_id,
            externalClient: ev.external_client ?? s.externalClient,
            configOptions: configOptions ?? s.configOptions,
            currentModeId:
              selectedModeIdFromConfigOptions(configOptions) ?? s.currentModeId,
            supportsSessionFork: ev.supports_session_fork ?? s.supportsSessionFork,
            forkSupport: forkSupportFromWire(ev.fork_support) ?? s.forkSupport,
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
            authRequired: auth?.status === "needs-auth",
            auth: auth ?? {
              status: "configured",
              message: "ACP auth is configured.",
              ...(s.auth?.methodId ? { methodId: s.auth.methodId } : {}),
              ...(s.auth?.methodName ? { methodName: s.auth.methodName } : {}),
              ...(s.auth?.methods ? { methods: s.auth.methods } : {}),
            },
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
            workspaceId: ev.workspace_id ?? undefined,
            externalClient: ev.external_client,
            acp_session_id: ev.acp_session_id,
            label: `${ev.agent_id} · ${ev.session_id.slice(0, 6)}`,
            status: "ready",
            createdAt: Date.now(),
            configOptions,
            currentModeId: selectedModeIdFromConfigOptions(configOptions),
            supportsSessionFork: ev.supports_session_fork,
            forkSupport: forkSupportFromWire(ev.fork_support),
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
            authRequired: auth?.status === "needs-auth",
            auth: auth ?? { status: "configured", message: "ACP auth is configured." },
          });
        }
        if (!this.#activeId) this.#activeId = ev.session_id;
        break;
      }
      case "session.event": {
        if (this.#applySubagentSession(ev.session_id, ev.event, ev.turn_id)) {
          const rfdEventId = `subagent-session:${crypto.randomUUID()}`;
          this.#rfdAppliedEvents.add(rfdEventId);
          this.#ingestOpenMAEvent(createVendorEvent({
            event_id: rfdEventId,
            session_id: ev.session_id, ...(ev.turn_id ? { turn_id: ev.turn_id } : {}),
            source: { kind: "harness", harness: this.#sessions.get(ev.session_id)?.agent_id ?? "acp" },
            occurred_at: new Date().toISOString(), harness: "acp", namespace: "subagent_sessions",
            name: "update", data: ev.event,
          }), { persist: true });
          break;
        }
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
            availableCommands: withoutAuthSlashCommands(parsed.commands),
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
            ...this.#modelAuthRecovery(s, configOptions),
            configOptions,
            currentModeId:
              selectedModeIdFromConfigOptions(configOptions) ?? s.currentModeId,
          }));
          break;
        }
        const toolOwner = !ev.turn_id ? this.#existingToolOwner(ev.session_id, semanticEvent) : undefined;
        const eventTurnId = ev.turn_id || toolOwner?.id || "";
        if (!eventTurnId && parsed.kind === "tool_call") break;
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
            eventTurnId,
          );
          // A child-correlated usage update belongs to the native work item,
          // not to the parent session usage snapshot. The same rule keeps
          // nested text/thought/tool updates out of the parent transcript.
          break;
        }
        // Lifecycle metadata is session-scoped, not an ACP turn boundary (I1/I5).
        // Consume it before the generic metadata handler returns early.
        if (updateType === "session_info_update") {
          this.#ingestNativeAgentUpdates(
            ev.session_id,
            runtimeAdapter?.nativeAgentRawUpdates(ev.event) ?? [],
            { turnId: eventTurnId },
          );
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
              turnId: eventTurnId || undefined,
              occurredAt: new Date().toISOString(),
              adapter: runtimeAdapter!.provider,
            },
          ), { persist: true });
        }
        if (!eventTurnId && parsed.kind === "text") {
          if (parsed.text.trim()) this.#showNotice(ev.session_id, parsed.text.trim(), "warning");
          break;
        }
        let turn = this.#turns.get(eventTurnId);
        if (!turn) {
          turn = {
            id: eventTurnId,
            sessionId: ev.session_id,
            promptText: "",
            events: [],
            assistantText: "",
            thoughtText: "",
            status: "running",
            startedAt: Date.now(),
          };
          this.#turns.set(eventTurnId, turn);
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
              turn.assistantText += text;
              if (text) this.#emitStream(eventTurnId, { kind: "assistant", text });
            } else {
              if (thoughtMessageChanged || thoughtSectionBreak) {
                turn.activeThoughtMessageId = parsed.messageId;
                turn.activeThoughtSegmentText = "";
              }
              if (!thoughtSectionBreak) {
                turn.activeThoughtSegmentText =
                  (turn.activeThoughtSegmentText ?? "") + text;
              }
              turn.thoughtText += text;
              if (text) this.#emitStream(eventTurnId, { kind: "thought", text });
            }
            // Preserve timeline ordering without retaining one array entry
            // per token. React is deliberately asleep in this branch; the
            // next structural event/turn completion publishes the compacted
            // event list.
            const openedSegment = this.#appendStreamEvent(
              turn,
              parsed.kind,
              text,
              Date.now(),
              {
                messageId: parsed.messageId,
                ...(parsed.kind === "text" ? { phase: parsed.phase } : {}),
              },
            );
            let ingestedWorkItemEvents = false;
            if (parsed.kind === "text" && runtimeAdapter?.assistantBackgroundWorkItemUpdates) {
              for (const update of runtimeAdapter.assistantBackgroundWorkItemUpdates(text)) {
                for (const event of runtimeWorkItemUpdateToOpenMAEvents(update, {
                  sessionId: ev.session_id,
                  turnId: eventTurnId,
                  occurredAt: new Date().toISOString(),
                  adapter: runtimeAdapter.provider,
                })) {
                  if (this.#ingestOpenMAEvent(event, { persist: true })) {
                    ingestedWorkItemEvents = true;
                  }
                }
              }
            }
            const shouldPublishStreamMount =
              shouldMountThought ||
              assistantNeedsMount ||
              // A tool call breaks the text run, so the text after it is a new
              // segment with no mounted live tail of its own. Only the first
              // text of a turn used to publish, which left every later
              // commentary segment invisible for as long as it streamed — it
              // appeared, already whole, at the next structural event.
              (parsed.kind === "text" && openedSegment) ||
              (parsed.kind === "text" && wasShowingThought);
            if (shouldPublishStreamMount) {
              // Selectors shallow-compare Turn identities. Replace this one
              // object exactly once so the streaming answer or Reasoning
              // block actually mounts; later chunks keep mutating the
              // replacement in place.
              this.#turns.set(eventTurnId, {
                ...turn,
                events: [...turn.events],
              });
            }
            const isHighFrequencyStreamChunk =
              ev.openma_event?.type === "agent.message_chunk" ||
              ev.openma_event?.type === "agent.thinking";
            if (
              shouldPublishStreamMount ||
              ingestedWorkItemEvents ||
              (ev.openma_event && !isHighFrequencyStreamChunk)
            ) {
              this.#emit();
            }
            this.#acceptOptimisticSend(eventTurnId);
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
        this.#turns.set(eventTurnId, {
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
              eventTurnId,
              runtimeAdapter.provider,
              backgroundLevel,
            );
          }
          this.#ingestNativeAgentUpdates(
            ev.session_id,
            runtimeAdapter.nativeAgentRawUpdates(ev.event),
            { turnId: eventTurnId },
          );
          for (const update of runtimeAdapter.backgroundWorkItemRawUpdates?.(
            ev.event,
          ) ?? []) {
            this.#ingestRuntimeWorkItemUpdate(
              ev.session_id,
              eventTurnId,
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
          const turn = this.#turns.get(eventTurnId);
          const tool = (turn ? this.projectTurn(turn) : undefined)?.tools.find(
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
            eventTurnId,
          );
          this.#backfillRfdActivityFromParentTool(ev.session_id, tool);
          const workItemAdapter = runtimeAdapter ?? genericAcpRuntimeAdapter;
          for (const update of workItemAdapter.planToolUpdates(tool)) {
            const planEvent = runtimePlanUpdateToOpenMAEvent(update, {
              sessionId: ev.session_id,
              turnId: eventTurnId,
              occurredAt: new Date().toISOString(),
              adapter: workItemAdapter.provider,
            });
            if (this.#ingestOpenMAEvent(planEvent, { persist: true })) {
              const currentTurn = this.#turns.get(eventTurnId);
              if (currentTurn) {
                this.#turns.set(eventTurnId, {
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
              eventTurnId,
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
          const openmaEvent = ev.openma_event;
          const data =
            openmaEvent?.data && typeof openmaEvent.data === "object"
              ? openmaEvent.data as Record<string, unknown>
              : undefined;
          const activeTurnId =
            typeof data?.active_turn_id === "string"
              ? data.active_turn_id
              : ev.active_turn_id;
          if (
            openmaEvent?.type === "user.message"
            && data?.input_kind === "steering"
            && data?.outcome === "injected"
            && activeTurnId
          ) {
            const turn = this.#turns.get(activeTurnId) ?? {
              id: activeTurnId,
              sessionId: ev.session_id,
              promptText: "",
              events: [],
              assistantText: "",
              thoughtText: "",
              status: "running" as const,
              startedAt: Date.now(),
            };
            const eventId = openmaEvent.event_id;
            if (!turn.events.some((entry) =>
              isPlainRecord(entry.payload) && entry.payload.event_id === eventId
            )) {
              this.#turns.set(activeTurnId, {
                ...turn,
                events: [
                  ...turn.events,
                  { payload: openmaEvent, receivedAt: Date.now() },
                ],
              });
            }
            if (ev.turn_id !== activeTurnId) this.#deleteTurn(ev.turn_id);
          } else {
            const turn = this.#turns.get(ev.turn_id);
            if (turn) {
              this.#turns.set(ev.turn_id, {
                ...turn,
                status: "complete",
                effectiveDelivery: ev.effective_delivery,
                deliveryDegraded: ev.delivery_degraded ?? false,
              });
            }
          }
        } else if (ev.outcome === "startedNewTurn") {
          const openmaEvent = ev.openma_event;
          const data =
            openmaEvent?.data && typeof openmaEvent.data === "object"
              ? openmaEvent.data as Record<string, unknown>
              : undefined;
          const turn =
            this.#turns.get(ev.turn_id)
            ?? (openmaEvent?.type === "user.message"
              ? {
                  id: ev.turn_id,
                  sessionId: ev.session_id,
                  promptText: typeof data?.text === "string" ? data.text : ev.text,
                  events: [],
                  assistantText: "",
                  thoughtText: "",
                  status: "running" as const,
                  startedAt: Date.now(),
                }
              : undefined);
          if (
            turn
            && openmaEvent?.type === "user.message"
            && data?.input_kind === "steering"
            && data?.outcome === "startedNewTurn"
          ) {
            const eventId = openmaEvent.event_id;
            this.#turns.set(ev.turn_id, {
              ...turn,
              events: turn.events.some((entry) =>
                isPlainRecord(entry.payload) && entry.payload.event_id === eventId
              )
                ? turn.events
                : [...turn.events, { payload: openmaEvent, receivedAt: Date.now() }],
              status: "running",
              endedAt: undefined,
            });
          }
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
          this.#turns.set(ev.turn_id, {
            ...turn,
            events: [...turn.events, {
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
            }],
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
      case "session.prompt_accepted": {
        this.#adoptOptimisticTurn(
          ev.session_id,
          ev.client_id,
          ev.turn_id,
          ev.text,
        );
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
            ...(ev.stop_reason ? { stopReason: ev.stop_reason } : {}),
            endedAt: Date.now(),
          });
          this.#settleNativeSubagentsForTurn(ev.session_id, turn);
          this.#settleBackgroundWorkItemsForTurn(ev.session_id, turn);
          // A successful turn is the only thing that clears a terminal
          // provider failure from the feed. The failed turn keeps its
          // explanation while the user retries; once a later turn in this
          // session succeeds, the preceding sticky provider rows are gone.
          this.#clearStickyProviderFeedErrors(
            ev.session_id,
            turn.id,
            turn.startedAt,
          );
          // The session itself is healthy again, so the session-level error
          // state must not survive the success either (the replay path already
          // drops it on turn.completed).
          this.#mutateSession(ev.session_id, (s) => (
            s.lastError === undefined ? s : { ...s, lastError: undefined }
          ));
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
        // I1/I2/I11: a queue snapshot cannot reopen a resolved prompt, and an
        // injected steer belongs to its parent rather than a second live turn.
        const isSettled = (id: string) => {
          const turn = this.#turns.get(id);
          return turn?.sessionId === ev.session_id
            && turn.status !== "running" && turn.status !== "queued";
        };
        // I1/I11: a snapshot naming a terminal prompt is stale as a whole;
        // filtering it into an empty queue would incorrectly settle a newer turn.
        if (ev.active_turn_id && isSettled(ev.active_turn_id)) break;
        const activeTurnId = ev.active_turn_id ?? undefined;
        const nextQueuedIds = ev.queued.map((prompt) => prompt.turn_id).filter(id => !isSettled(id));
        const nextQueued = new Set(nextQueuedIds);
        const steeringTurnIds = (ev.steering_turn_ids ?? []).filter(id => {
          if (isSettled(id)) return false;
          for (const turn of this.#turns.values()) {
            if (turn.sessionId !== ev.session_id) continue;
            const injected = turn.events.some(entry => {
              const payload = entry.payload;
              return isPlainRecord(payload) && payload.type === "user.message"
                && payload.turn_id === id && isPlainRecord(payload.data)
                && payload.data.input_kind === "steering" && payload.data.outcome === "injected";
            });
            if (injected) return false;
          }
          return true;
        });
        const steeringTurns = new Set(steeringTurnIds);
        const previous = this.#sessions.get(ev.session_id);
        const previousQueued = new Set(
          previous?.queuedTurnIds ?? previous?.queuedPrompts?.map((prompt) => prompt.turn_id) ?? [],
        );
        for (const turnId of previousQueued) {
          if (
            nextQueued.has(turnId)
            || steeringTurns.has(turnId)
            || turnId === activeTurnId
          ) continue;
          const turn = this.#turns.get(turnId);
          if (turn?.sessionId === ev.session_id && turn.status === "queued") {
            this.#deleteTurn(turnId);
          }
        }
        for (const turnId of steeringTurnIds) {
          this.#markTurnRunning(turnId);
        }
        for (const prompt of ev.queued.filter(prompt => nextQueued.has(prompt.turn_id))) {
          const turn = this.#turns.get(prompt.turn_id);
          if (turn?.sessionId === ev.session_id) {
            this.#turns.set(prompt.turn_id, {
              ...turn,
              promptText: prompt.text,
              status: "queued",
            });
          }
        }
        this.#markTurnRunning(activeTurnId);
        this.#settleOrphanedRunningTurns(ev.session_id, activeTurnId, steeringTurnIds);
        this.#mutateSession(ev.session_id, (s) => ({
          ...s,
          activeTurnId,
          queuedTurnIds: nextQueuedIds.length ? nextQueuedIds : undefined,
          queuedPrompts: ev.queued.filter(prompt => nextQueued.has(prompt.turn_id)),
          status: activeTurnId
            || steeringTurnIds.length > 0
            ? "running"
            : s.status === "running"
              ? "ready"
              : s.status,
        }));
        break;
      }
      case "session.error": {
        const interrupted = isRestartableAgentInterruption(
          ev.agent_id ?? this.#sessions.get(ev.session_id)?.agent_id,
          ev.error_details,
        );
        const authRequired = ev.code === "auth_required"
          || isAuthenticationFailureMessage(ev.message);
        const message = sanitizeAuthenticationMessage(ev.message);
        const turnId = ev.turn_id
          ?? this.#sessions.get(ev.session_id)?.activeTurnId;
        if (turnId) {
          const turn = this.#turns.get(turnId);
          if (turn) {
            const sendFailed = turn.sendState === "pending" && turn.events.length === 0;
            this.#turns.set(turnId, {
              ...turn,
              status: interrupted ? "cancelled" : "error",
              stopReason: interrupted ? "interrupted" : turn.stopReason,
              errorMessage: interrupted ? undefined : message,
              sendState: !interrupted && sendFailed ? "failed" : undefined,
              sendError: !interrupted && sendFailed ? message : undefined,
              endedAt: Date.now(),
            });
          }
          this.#advanceAfterTurn(ev.session_id, turnId);
          this.#recordSubagentActivity(ev.session_id, {
            status: "error",
            errorMessage: message,
          });
          this.#dropPairPendingForSession(ev.session_id, turnId);
        }
        this.#mutateSession(ev.session_id, (s) => ({
          ...s,
          // Auth is recoverable from this chat. Other session-wide errors
          // (unknown agent, missing binary, handshake refused) still lock.
          status: authRequired
            ? (s.status === "draft" ? "draft" : "ready")
            : turnId ? s.status : "errored",
          lastError: authRequired || interrupted ? undefined : message,
          authRequired: authRequired ? true : s.authRequired,
          authRetryAllowed: authRequired ? false : s.authRetryAllowed,
          supportsLogout: ev.auth?.supportsLogout ?? s.supportsLogout,
          auth: ev.auth ?? (authRequired
            ? { status: "needs-auth", message }
            : s.auth),
        }));
        break;
      }
      case "session.retitled": {
        this.#mutateSession(ev.session_id, (s) => (
          s.titleManuallySet ? s : { ...s, label: ev.title }
        ));
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
          if (turn.sessionId === ev.session_id) this.#deleteTurn(tid);
        }
        break;
      }
    }
    if (
      ev.type === "session.event"
      || ev.type === "session.complete"
      || ev.type === "session.cancelled"
      || ev.type === "session.steering"
    ) {
      this.#acceptOptimisticSend(ev.turn_id);
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

const NO_AVAILABLE_COMMANDS: readonly AcpAvailableCommand[] = [];

/** Commands this session advertises. Returns the stored array itself so the
 *  reference stays stable across reads; mapping here would hand every render a
 *  new array and churn every subscriber. */
export const selectAvailableCommandsFor =
  (sessionId: string) => (s: SessionStore) =>
    s.get(sessionId)?.availableCommands ?? NO_AVAILABLE_COMMANDS;

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

function canonicalSessionAuth(value: unknown): SessionRow["auth"] {
  if (!isPlainRecord(value) || typeof value.message !== "string") return undefined;
  if (value.status !== "configured" && value.status !== "needs-auth" && value.status !== "unknown") return undefined;
  return value as NonNullable<SessionRow["auth"]>;
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

/** Subagent ids whose lifecycle is in the replayed log, following
 *  reidentification from the provisional id to the final one. */
function canonicalNativeAgentIdsOf(
  facts: readonly NativeAgentLifecycleFact[],
): Set<string> {
  const ids = new Set<string>();
  for (const fact of facts) {
    if (fact.type === "started") ids.add(fact.id);
    else if (ids.delete(fact.previousId)) ids.add(fact.id);
  }
  return ids;
}

/** A prompt-less continuation (newer rows of a turn that opened in an older
 *  page) joins its turn: prompt-side fields come from the turn, progress and
 *  terminal fields from the continuation, which holds the newer rows. */
function foldHeadIntoTurn(owner: Turn, head: Turn): Turn {
  return {
    ...owner,
    events: [...owner.events, ...head.events],
    assistantText: owner.assistantText + head.assistantText,
    thoughtText: owner.thoughtText + head.thoughtText,
    activeThoughtMessageId: head.activeThoughtMessageId,
    activeThoughtSegmentText: head.activeThoughtSegmentText,
    status: head.status,
    stopReason: head.stopReason ?? owner.stopReason,
    errorMessage: head.errorMessage ?? owner.errorMessage,
    effectiveDelivery: head.effectiveDelivery ?? owner.effectiveDelivery,
    deliveryDegraded: head.deliveryDegraded ?? owner.deliveryDegraded,
    endedAt: head.endedAt ?? owner.endedAt,
  };
}

/** A subagent transcript that spans a page boundary: the older page's part
 *  goes in front of what the newer rows already projected. */
function concatChildTranscriptTurns(older: Turn, newer: Turn): Turn {
  return {
    ...newer,
    promptText: newer.promptText || older.promptText,
    events: [...older.events, ...newer.events],
    assistantText: older.assistantText + newer.assistantText,
    thoughtText: older.thoughtText + newer.thoughtText,
    startedAt: Math.min(older.startedAt, newer.startedAt),
  };
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
