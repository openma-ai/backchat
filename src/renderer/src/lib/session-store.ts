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
import type { SessionEventOut } from "@shared/session-events.js";
import { setRightRailCollapsed } from "@/lib/right-rail";
import {
  normalizeAgentConfigOptions,
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
  type NativeAgentUpdate,
} from "./native-agent-events";
import {
  subagentAvatarId,
  type SubagentAvatarId,
} from "./subagent-avatar";
import {
  appendUnique,
  nativeActivitySessionStatus,
  nativeActivityTurnStatus,
  nativeChildThreadId,
  nativeProviderForAgent,
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
  extractFilePaths,
  extractHtmlPathsFromExecute,
  extractServiceUrls,
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
  StreamDelta,
  StreamSubscriber,
  SubagentActivity,
  SubagentInheritance,
  TaskBrowserWindow,
  TaskSideWorkspaceSnapshot,
  Turn,
  TurnDeliveryMeta,
  WorkspaceArtifacts,
} from "./session-types";

export type { AcpSessionConfigOption } from "./session-config-options";
export type * from "./session-types";

export class SessionStore {
  static readonly NOTICE_DURATION_MS = 10_000;

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
  #noticeTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
        .filter((tab) => tab.type !== "interactive");
      const artifacts = this.#artifactsBySession.get(taskId) ?? { files: [], services: [] };
      const subagents = this.#subagentsByParent.get(taskId) ?? [];
      if (sourceTabs.length === 0 && artifacts.files.length === 0 && artifacts.services.length === 0 && subagents.length === 0) {
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
      if (artifacts.files.length > 0 || artifacts.services.length > 0) {
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
  newDraft(chosenCwd?: string): string {
    for (const [existingId, session] of this.#sessions) {
      if (session.status === "draft" && session.kind !== "side") {
        this.#sessions.delete(existingId);
      }
    }
    const id = `sess-${Math.random().toString(36).slice(2, 10)}`;
    const normalizedCwd = chosenCwd?.trim() || undefined;
    this.#sessions.set(id, {
      id,
      agent_id: "",
      cwd: "",
      acp_session_id: "",
      label: "",
      status: "draft",
      createdAt: Date.now(),
      chosenCwd: normalizedCwd,
      projectScope: normalizedCwd ? "project" : "none",
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
      const threadStatus = readAgentThreadStatus(nextMeta);
      return {
        ...s,
        label:
          typeof inner.title === "string" && inner.title.trim()
            ? inner.title.trim().slice(0, 500)
            : s.label,
        sessionUpdatedAt:
          typeof inner.updatedAt === "string"
            ? inner.updatedAt
            : s.sessionUpdatedAt,
        sessionInfoMeta: nextMeta,
        agentThreadStatus: threadStatus ?? s.agentThreadStatus,
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
          acp_session_id: r.acp_session_id || s.acp_session_id,
          label: r.title || s.label,
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
            this.#appendStreamEvent(current, "text", parsed.text, r.ts, {
              messageId: parsed.messageId,
              phase: parsed.phase,
            });
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
        const pendingBeforeReady = this.#pendingAsksBeforeSession.get(ev.session_id);
        this.#pendingAsksBeforeSession.delete(ev.session_id);
        const configOptions = normalizeAgentConfigOptions(ev.config_options);
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
            acp_session_id: ev.acp_session_id,
            label: `${ev.agent_id} · ${ev.session_id.slice(0, 6)}`,
            status: "ready",
            createdAt: Date.now(),
            configOptions,
            currentModeId: selectedModeIdFromConfigOptions(configOptions),
            supportsSessionFork: ev.supports_session_fork,
            pendingAsks: pendingBeforeReady,
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
        if (
          this.#applyAcpSessionMetadata(ev.session_id, updateType, inner)
        ) {
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
        // React stays asleep during the stream, except for the first thought
        // chunk: that single publish mounts the existing Reasoning block.
        // Subsequent thought/text chunks stay on the direct stream channel.
        if (parsed.kind === "text" || parsed.kind === "thought") {
          const text = parsed.text;
          if (text.length > 0) {
            const wasShowingThought =
              Boolean(turn.activeThoughtMessageId) ||
              Boolean(turn.activeThoughtSegmentText);
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
            if (
              shouldMountThought ||
              (parsed.kind === "text" && wasShowingThought)
            ) {
              // Selectors shallow-compare Turn identities. Replace this one
              // object exactly once so the Reasoning block actually mounts;
              // later chunks keep mutating the replacement in place.
              this.#turns.set(ev.turn_id, { ...turn });
              this.#emit();
            }
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

function readAgentThreadStatus(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  const codex = isPlainRecord(meta?.codex) ? meta.codex : undefined;
  const threadStatus = isPlainRecord(codex?.threadStatus)
    ? codex.threadStatus
    : undefined;
  return typeof threadStatus?.type === "string"
    ? threadStatus.type
    : undefined;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
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
