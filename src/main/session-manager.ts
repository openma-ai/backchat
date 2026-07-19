/**
 * SessionManager — owns the ACP child processes the desktop is running.
 *
 * One process per session, one session per workspace cwd. Lightweight rewrite
 * of openma's cli/bridge SessionManager with the remote control-plane stripped
 * out: no tenant keys, no bundle fetch, no mcp-proxy URL rewriting, no
 * daemon-level WS. Local-only.
 *
 * Wire shape (renderer-visible, see ipc-channels.ts):
 *
 *   Renderer → Main (request/response, ipcMain.handle)
 *     session.start    { session_id, agent_id, cwd?, resume? }
 *     session.prompt   { session_id, turn_id, text }
 *     session.cancel   { session_id, turn_id }
 *     session.dispose  { session_id }
 *
 *   Main → Renderer (push, webContents.send)
 *     session.event   { session_id, turn_id, event }
 *     session.ready   { session_id, acp_session_id }
 *     session.complete{ session_id, turn_id }
 *     session.error   { session_id, turn_id?, message }
 *     session.disposed{ session_id }
 *
 * Idempotency: session.start is idempotent — if a session with this id is
 * already alive, re-ack `session.ready` and skip the spawn. Lets the renderer
 * fire start at the top of every turn without tracking state.
 */

import { spawn as childSpawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AcpRuntimeImpl,
  type AcpSession,
  type ClientCallbacks,
  type ContentBlock,
  type PromptCapabilities,
} from "@open-managed-agents-desktop/acp";
import { NodeSpawner } from "@open-managed-agents-desktop/acp/node-spawner";
import { resolveKnownAgent, type KnownAgentEntry } from "@open-managed-agents-desktop/acp/registry";
import type {
  PromptAnnotation,
  PromptAttachment,
  SessionConfigOption,
  SessionEventOut,
  SessionPromptParams,
  SessionSetConfigOptionParams,
  SessionStartParams,
  SessionStartResult,
} from "../shared/session-events.js";
import { extractAcpSystemNotice } from "../shared/acp-system-notices.js";
import type { AgentMessageDelivery } from "../shared/agent-interaction.js";
import { ensureSessionCwd, removeSessionCwd } from "./session-cwd.js";
import {
  appendEvent,
  archiveSession,
  setSessionTitle,
  setSessionTitleIfEmpty,
  touchSession,
  upsertSession,
} from "./sql-store.js";

export type Sender = (msg: SessionEventOut) => void;

interface ActiveSession {
  id: string;
  acp: AcpSession;
  acpSessionId: string;
  agentId: string;
  cwd: string;
  /** Live turns keyed by turn_id. abort() cancels the ACP request and unwinds
   *  the prompt() async iterator. */
  turns: Map<string, AbortController>;
  promptQueue: Promise<void>;
  activePromptTurnId: string | null;
  queuedPrompts: QueuedPrompt[];
  promptQueueEnabled: boolean;
  /** Main-process timestamp used only for start→prompt latency diagnostics. */
  readyAt: number;
  disposed: boolean;
}

interface QueuedPrompt {
  turnId: string;
  text: string;
  createdAt: number;
}

export interface SessionManagerDeps {
  send: Sender;
  acpBinDir?: string;
  acpInstallRoot?: string;
  /** Build the per-session ACP McpServer[] for `session/new`. Returns the
   *  user's globally-configured servers (from settings, see Phase 8 for the
   *  per-agent override matrix). */
  resolveMcpServers: (agentId: string, taskId: string) => unknown[];
  /** Per-session client callbacks (permission/fs/terminal). Returned object's
   *  identity changes per session — each call yields a closure bound to the
   *  given session_id so brokers know which window to dispatch to. The
   *  spawn cwd is passed so the fs broker can scope "inside cwd → auto
   *  allow" without re-deriving the path. */
  buildCallbacks: (sessionId: string, sessionCwd: string) => ClientCallbacks;
  /** Settings-driven runtime preferences consulted by `start()`.
   *
   *  `agentOverride` lets per-agent config (custom command, extra env)
   *  reach the spawn step. Settings/Agents UI populates this. */
  resolveDefaults: () => {
    /** Legacy fixture/config compatibility only. Session start deliberately
     * ignores this value and requires `SessionStartParams.agent_id`. */
    agentId?: string;
    cwd?: string;
    permissionMode?: "ask" | "auto" | "read_only";
    promptQueueEnabled?: boolean;
  };
  resolveAgentOverride: (
    agentId: string,
  ) =>
    | {
        labelOverride?: string;
        commandOverride?: string;
        argsOverride?: string[];
        envOverride?: Record<string, string>;
      }
    | undefined;
}

export class SessionManager {
  #send: Sender;
  #resolveMcpServers: SessionManagerDeps["resolveMcpServers"];
  #buildCallbacks: SessionManagerDeps["buildCallbacks"];
  #resolveDefaults: SessionManagerDeps["resolveDefaults"];
  #resolveAgentOverride: SessionManagerDeps["resolveAgentOverride"];
  #spawner = new NodeSpawner();
  #runtime = new AcpRuntimeImpl(this.#spawner);
  #sessions = new Map<string, ActiveSession>();
  #starting = new Map<string, Promise<SessionStartResult>>();
  #cancelledStarts = new Set<string>();

  constructor(deps: SessionManagerDeps) {
    this.#send = deps.send;
    this.#resolveMcpServers = deps.resolveMcpServers;
    this.#buildCallbacks = deps.buildCallbacks;
    this.#resolveDefaults = deps.resolveDefaults;
    this.#resolveAgentOverride = deps.resolveAgentOverride;
  }

  setSender(send: Sender): void {
    this.#send = send;
  }

  #readyResult(
    session_id: string,
    sess: Pick<ActiveSession, "acpSessionId" | "agentId" | "cwd" | "acp">,
  ): SessionStartResult {
    const result: Extract<SessionStartResult, { status: "ready" }> = {
      status: "ready",
      session_id,
      acp_session_id: sess.acpSessionId,
      agent_id: sess.agentId,
      cwd: sess.cwd,
      config_options: [...sess.acp.configOptions],
      supports_session_fork: sess.acp.supportsSessionFork,
    };
    this.#send({
      type: "session.ready",
      session_id,
      acp_session_id: result.acp_session_id,
      agent_id: result.agent_id,
      cwd: result.cwd,
      config_options: result.config_options,
      supports_session_fork: result.supports_session_fork,
    });
    return result;
  }

  #errorResult(session_id: string, message: string): SessionStartResult {
    this.#send({ type: "session.error", session_id, message });
    return { status: "error", session_id, message };
  }

  has(id: string): boolean {
    return this.#sessions.has(id);
  }

  sessionCount(): number {
    return this.#sessions.size;
  }

  /** Re-announce alive sessions — used by the renderer's mount handshake so a
   *  reload sees what's running. */
  announceAll(): void {
    for (const [session_id, sess] of this.#sessions) {
      this.#readyResult(session_id, sess);
    }
  }

  async start(p: SessionStartParams): Promise<SessionStartResult> {
    const inFlight = this.#starting.get(p.session_id);
    if (inFlight) return inFlight;
    const operation = this.#startOnce(p);
    this.#starting.set(p.session_id, operation);
    try {
      return await operation;
    } finally {
      if (this.#starting.get(p.session_id) === operation) {
        this.#starting.delete(p.session_id);
        this.#cancelledStarts.delete(p.session_id);
      }
    }
  }

  async #startOnce(p: SessionStartParams): Promise<SessionStartResult> {
    const startRequestedAt = Date.now();
    // Idempotent re-ack.
    const existing = this.#sessions.get(p.session_id);
    if (existing) {
      return this.#readyResult(p.session_id, existing);
    }

    // Agent selection belongs to the renderer's recent-run preference. The
    // main process requires an explicit id so a stale legacy default can
    // never silently launch the wrong harness.
    const defaults = this.#resolveDefaults();
    const requestedAgentId = p.agent_id || "";
    if (!requestedAgentId) {
      return this.#errorResult(
        p.session_id,
        "No agent selected. Pick an enabled agent and try again.",
      );
    }
    const knownAgent = resolveKnownAgent(requestedAgentId);
    const override = this.#resolveAgentOverride(requestedAgentId) ?? {};
    const agent = knownAgent ?? customAgentFromOverride(requestedAgentId, override);
    if (!agent) {
      return this.#errorResult(
        p.session_id,
        `unknown ACP agent: ${requestedAgentId}`,
      );
    }

    // Apply per-agent overrides from settings — lets the user point at a
    // custom binary path or inject env vars (ANTHROPIC_API_KEY etc.) per
    // agent without touching the registry.
    let command = override.commandOverride || agent.spec.command;
    const args = override.argsOverride ?? agent.spec.args;
    const agentEnv = scrubAcpSpawnEnv({
      ...(agent.spec.env ?? {}),
      ...(override.envOverride ?? {}),
    });

    // Verify binary is on PATH. Defense in depth: detectAll() should have
    // gated the picker, but the user could uninstall between picker and
    // start. Surface a clean error with the install hint instead of letting
    // child_process throw an unhelpful ENOENT.
    const onPath = await commandExists(command);
    if (!onPath) {
      return this.#errorResult(
        p.session_id,
        `binary not on PATH for ${agent.id}: \`${command}\`` +
          (agent.installHint ? `. Install: ${agent.installHint}` : ""),
      );
    }

    // New main-chat drafts carry an explicit workspace policy so global
    // chats cannot silently inherit settings.default.workspace_path.
    // Calls without a policy retain the legacy resolution used by resumes.
    let sessionCwd: string;
    if (p.workspace_mode === "managed") {
      sessionCwd = await ensureSessionCwd(p.session_id);
    } else if (
      p.workspace_mode === "project"
      || p.workspace_mode === "inherited"
    ) {
      if (!p.cwd?.trim()) {
        return this.#errorResult(
          p.session_id,
          `${p.workspace_mode} workspace mode requires a cwd.`,
        );
      }
      sessionCwd = p.cwd.trim();
    } else {
      sessionCwd =
        p.cwd ?? (await ensureSessionCwd(p.session_id));
    }
    const runtimeAgentEnv = await prepareAcpToolEnvironment(
      agent.id,
      agentEnv,
    );
    if (process.env.NODE_ENV !== "test") {
      process.stderr.write(
        `[session-cwd] sid=${p.session_id.slice(0, 12)} mode=${p.workspace_mode ?? "managed-fallback"} requested=${p.cwd ?? "(none)"} resolved=${sessionCwd}\n`,
      );
    }

    try {
      if (this.#cancelledStarts.has(p.session_id)) {
        return { status: "cancelled", session_id: p.session_id };
      }
      const runtimeStartedAt = Date.now();
      const acpSession = await this.#runtime.start({
        agent: {
          command,
          args,
          cwd: sessionCwd,
          env: runtimeAgentEnv,
        },
        mcpServers: this.#resolveMcpServers(agent.id, p.session_id) as never,
        resumeAcpSessionId: p.resume?.acp_session_id,
        forkFromAcpSessionId: p.fork?.acp_session_id,
        clientCallbacks: this.#buildCallbacks(p.session_id, sessionCwd),
      });
      if (this.#cancelledStarts.has(p.session_id)) {
        await Promise.resolve(acpSession.dispose()).catch(() => undefined);
        return { status: "cancelled", session_id: p.session_id };
      }
      this.#sessions.set(p.session_id, {
        id: p.session_id,
        acp: acpSession,
        acpSessionId: acpSession.acpSessionId,
        agentId: agent.id,
        cwd: sessionCwd,
        turns: new Map(),
        promptQueue: Promise.resolve(),
        activePromptTurnId: null,
        queuedPrompts: [],
        promptQueueEnabled: defaults.promptQueueEnabled !== false,
        readyAt: Date.now(),
        disposed: false,
      });
      // Persist the session shell — title stays empty for now, the renderer
      // can later derive it from the first user prompt or let the user
      // rename. ACP session id is captured so we can pass it back as
      // resume.acp_session_id on next launch.
      upsertSession({
        id: p.session_id,
        agent_id: agent.id,
        cwd: sessionCwd,
        acp_session_id: acpSession.acpSessionId,
        last_used_at: Date.now(),
      });
      const result = this.#readyResult(p.session_id, this.#sessions.get(p.session_id)!);
      this.#sendConfigOptions(p.session_id, acpSession.configOptions);
      if (process.env.NODE_ENV !== "test") {
        const readyAt = Date.now();
        process.stderr.write(
          `[session-latency] sid=${p.session_id.slice(0, 12)} agent=${agent.id} start_ready_ms=${readyAt - startRequestedAt} prepare_ms=${runtimeStartedAt - startRequestedAt} runtime_ms=${readyAt - runtimeStartedAt}\n`,
        );
      }
      const active = this.#sessions.get(p.session_id);
      if (active) {
        this.#flushPendingSessionState(active);
        setTimeout(() => {
          if (this.#sessions.get(active.id) === active) {
            this.#flushPendingSessionState(active);
          }
        }, 50);
      }
      return result;
    } catch (e) {
      if (this.#cancelledStarts.has(p.session_id)) {
        return { status: "cancelled", session_id: p.session_id };
      }
      return this.#errorResult(
        p.session_id,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  async prompt(p: SessionPromptParams): Promise<void> {
    const sess = this.#sessions.get(p.session_id);
    if (!sess) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        turn_id: p.turn_id,
        message: "no such session",
      });
      return;
    }
    if (process.env.NODE_ENV !== "test") {
      process.stderr.write(
        `[session-latency] sid=${p.session_id.slice(0, 12)} turn=${p.turn_id.slice(0, 12)} agent=${sess.agentId} ready_to_prompt_ms=${Date.now() - sess.readyAt}\n`,
      );
    }
    const effectiveDelivery = normalizeAcpPromptDelivery(p);
    if (effectiveDelivery === "unsupported") {
      const requestedDelivery = p.requested_delivery ?? p.effective_delivery ?? "unsupported";
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        turn_id: p.turn_id,
        message: `delivery ${requestedDelivery} is not supported by this ACP transport`,
      });
      return;
    }

    const requestedDelivery = p.requested_delivery ?? p.effective_delivery;
    const prompt = {
      ...p,
      effective_delivery: effectiveDelivery,
      delivery_degraded:
        p.delivery_degraded ||
        (requestedDelivery != null && requestedDelivery !== effectiveDelivery),
    };
    return this.#dispatchPrompt(sess, prompt);
  }

  #dispatchPrompt(sess: ActiveSession, p: SessionPromptParams): Promise<void> {
    const wasBusy = this.#promptBusy(sess);
    if (wasBusy) {
      this.#queuePrompt(sess, p);
    } else {
      sess.activePromptTurnId = p.turn_id;
      this.#sendPromptQueueUpdate(sess);
    }
    const run = async () => {
      if (sess.disposed) return;
      if (wasBusy) {
        sess.queuedPrompts = sess.queuedPrompts.filter((prompt) => prompt.turnId !== p.turn_id);
        sess.activePromptTurnId = p.turn_id;
        if (!sess.disposed) this.#sendPromptQueueUpdate(sess);
      }
      try {
        await this.#runPrompt(sess, p);
      } finally {
        if (sess.activePromptTurnId === p.turn_id) {
          sess.activePromptTurnId = null;
        }
        this.#sendPromptQueueUpdate(sess);
      }
    };
    sess.promptQueue = sess.promptQueue.then(run, run);
    return sess.promptQueue;
  }

  #promptBusy(sess: ActiveSession): boolean {
    return sess.activePromptTurnId !== null || sess.queuedPrompts.length > 0;
  }

  #queuePrompt(sess: ActiveSession, p: SessionPromptParams): void {
    const existing = sess.queuedPrompts.find((prompt) => prompt.turnId === p.turn_id);
    if (existing) {
      existing.text = p.text;
    } else {
      sess.queuedPrompts.push({
        turnId: p.turn_id,
        text: p.text,
        createdAt: Date.now(),
      });
    }
    this.#sendPromptQueueUpdate(sess);
  }

  #sendPromptQueueUpdate(sess: ActiveSession): void {
    if (sess.disposed) return;
    this.#send({
      type: "session.queue_update",
      session_id: sess.id,
      mode: "single",
      active_turn_id: sess.activePromptTurnId,
      queued: sess.queuedPrompts.map((prompt) => ({
        turn_id: prompt.turnId,
        text: prompt.text,
        created_at: prompt.createdAt,
      })),
    });
  }

  #flushPendingSessionState(sess: ActiveSession): void {
    for (const event of sess.acp.drainPendingEvents()) {
      this.#send({
        type: "session.event",
        session_id: sess.id,
        turn_id: "",
        event,
      });
    }
  }

  async #runPrompt(sess: ActiveSession, p: SessionPromptParams): Promise<void> {
    const promptStartedAt = Date.now();
    const ctrl = new AbortController();
    sess.turns.set(p.turn_id, ctrl);
    let promptErr: string | null = null;

    // Per-turn accumulators for persistence. Originally we coalesced
    // every agent_message_chunk into a single agent_message row at
    // end-of-turn (saving ~thousands of rows per turn), but that
    // destroyed the relative ordering between text chunks and
    // tool_call events — the renderer's timeline view could only show
    // "all tools, then a final message blob" on replay, while the live
    // session showed proper interleaving. We now persist each chunk
    // as it arrives so reload preserves the same time-ordered
    // structure live sessions get. Cost: maybe O(N) extra rows per
    // turn (N = tokens emitted), still well under SQLite's comfort
    // zone for our scale, and we still keep thoughtText/assistantText
    // accumulators because some other persistence consumers want a
    // single-string view.
    let assistantText = "";
    let thoughtText = "";
    let emittedVisibleOutput = false;
    let loggedFirstEvent = false;
    const observedEventTypes = new Set<string>();
    // Persist the user prompt up front — even if the turn errors halfway,
    // we want the user's message in the log for replay.
    const displayText = derivePromptDisplayText(p.text, p.attachments, p.annotations?.length ?? 0);
    appendEvent(p.session_id, "user_prompt", {
      text: displayText,
      attachments: stripAttachmentData(p.attachments),
      annotations: p.annotations,
    });
    // First prompt seeds the session title — without this, sidebar rows
    // for reload-restored sessions fall back to "agent · slug" and look
    // identical to each other. derivePromptLabel matches the renderer's
    // logic in ChatView.deriveLabel.
    setSessionTitleIfEmpty(p.session_id, derivePromptLabel(displayText));
    touchSession(p.session_id);

    try {
      const promptBlocks = buildAcpPromptBlocks(p, sess.acp.promptCapabilities);
      for await (const ev of sess.acp.prompt(promptBlocks, { abortSignal: ctrl.signal })) {
        if (ctrl.signal.aborted || sess.disposed) break;
        const t = (ev as { type?: string } | null | undefined)?.type;
        if (t === "promptComplete") continue;
        if (t === "promptError") {
          promptErr = (ev as { error?: string }).error ?? "ACP prompt error (no message)";
          continue;
        }
        if (!loggedFirstEvent) {
          loggedFirstEvent = true;
          if (process.env.NODE_ENV !== "test") {
            process.stderr.write(
              `[session-latency] sid=${p.session_id.slice(0, 12)} turn=${p.turn_id.slice(0, 12)} agent=${sess.agentId} prompt_first_event_ms=${Date.now() - promptStartedAt}\n`,
            );
          }
        }
        const ev2 = ev as { sessionUpdate?: string; content?: { type?: string; text?: string } } | null;
        const tag = ev2?.sessionUpdate;
        if (tag === "session_info_update") {
          const title = (ev as { title?: unknown }).title;
          if (typeof title === "string" && title.trim()) {
            setSessionTitle(p.session_id, title.trim().slice(0, 500));
          }
        }
        const systemNotice = extractAcpSystemNotice(ev);
        if (isUserVisibleAcpEvent(ev2) && !systemNotice) emittedVisibleOutput = true;
        if (tag === "agent_message_chunk" || tag === "agent_thought_chunk") {
          const c = ev2?.content;
          if (c?.type === "text" && typeof c.text === "string") {
            if (tag === "agent_message_chunk") {
              if (!systemNotice) assistantText += c.text;
            } else {
              thoughtText += c.text;
            }
          }
        }
        // Persist every ACP update, including future adapter events outside
        // the protocol shape this client currently understands. Boundary
        // rows retain the raw payload for gradual compatibility work.
        const persistenceType = acpEventPersistenceType(ev);
        if (persistenceType) {
          appendEvent(p.session_id, persistenceType, ev);
          if (!observedEventTypes.has(persistenceType)) {
            observedEventTypes.add(persistenceType);
            if (process.env.NODE_ENV !== "test") {
              process.stderr.write(
                `[acp-event] agent=${sess.agentId} type=${persistenceType} route=${acpEventUiRoute(ev)} ${acpEventShape(ev)}\n`,
              );
            }
          }
        }
        this.#send({
          type: "session.event",
          session_id: p.session_id,
          turn_id: p.turn_id,
          event: ev,
        });
      }
      if (sess.disposed) {
        return;
      } else if (promptErr) {
        this.#send({
          type: "session.error",
          session_id: p.session_id,
          turn_id: p.turn_id,
          message: promptErr,
        });
      } else if (
        sess.agentId === "pi-acp" &&
        !ctrl.signal.aborted &&
        !emittedVisibleOutput
      ) {
        this.#send({
          type: "session.error",
          session_id: p.session_id,
          turn_id: p.turn_id,
          message:
            "The agent finished without a response. Its provider may have rejected or rate-limited the request. Try again or choose another model.",
        });
      } else {
        this.#send({ type: "session.complete", session_id: p.session_id, turn_id: p.turn_id });
      }
    } catch (e) {
      if (sess.disposed) return;
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        turn_id: p.turn_id,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      if (!loggedFirstEvent && process.env.NODE_ENV !== "test") {
        process.stderr.write(
          `[session-latency] sid=${p.session_id.slice(0, 12)} turn=${p.turn_id.slice(0, 12)} agent=${sess.agentId} prompt_no_event_ms=${Date.now() - promptStartedAt}\n`,
        );
      }
      sess.turns.delete(p.turn_id);
      // thoughtText/assistantText accumulators are still maintained for
      // any in-process consumer; nothing reads them right now but we
      // keep the strings so the variable surface stays meaningful.
      void thoughtText;
      void assistantText;
      // Bump last_used_at so the sidebar reorders.
      touchSession(p.session_id);
    }
  }

  async setConfigOption(p: SessionSetConfigOptionParams): Promise<void> {
    const sess = this.#sessions.get(p.session_id);
    if (!sess) {
      throw new Error("no such session");
    }
    const configOptions = await sess.acp.setConfigOption(p.config_id, p.value);
    this.#send({
      type: "session.event",
      session_id: p.session_id,
      turn_id: "",
      event: {
        sessionUpdate: "config_option_update",
        configOptions,
      },
    });
  }

  cancel(session_id: string, turn_id: string): void {
    const sess = this.#sessions.get(session_id);
    if (!sess) return;
    const turn = sess.turns.get(turn_id);
    if (!turn) return;
    turn.abort();
    this.#onSessionPendingWorkCancelled?.(session_id);
  }

  async dispose(session_id: string, opts?: { removeCwd?: boolean }): Promise<void> {
    const starting = this.#starting.get(session_id);
    if (starting) {
      this.#cancelledStarts.add(session_id);
    }
    await this.#killChild(session_id);
    if (starting) await starting.catch(() => undefined);
    if (opts?.removeCwd) await removeSessionCwd(session_id);
    // Archive (soft-delete) in the persisted store so the sidebar stops
    // showing it but the history rows stay for any future "show archived"
    // surface. Hard delete waits for an explicit user gesture.
    try {
      archiveSession(session_id);
    } catch { /* db may not be open in test paths */ }
    this.#send({ type: "session.disposed", session_id });
  }

  async disposeAll(): Promise<void> {
    for (const id of this.#starting.keys()) {
      this.#cancelledStarts.add(id);
    }
    const starting = [...this.#starting.values()];
    const ids = [...this.#sessions.keys()];
    await Promise.allSettled([
      ...starting,
      ...ids.map((id) => this.#killChild(id)),
    ]);
  }

  async #killChild(session_id: string): Promise<void> {
    const sess = this.#sessions.get(session_id);
    if (!sess) return;
    sess.disposed = true;
    sess.queuedPrompts = [];
    for (const ctrl of sess.turns.values()) ctrl.abort();
    await Promise.resolve(sess.acp.dispose()).catch(() => undefined);
    this.#sessions.delete(session_id);
    // Unblock any pending permission / fs / terminal request for this
    // session — its ACP child is gone, no one will answer them.
    this.#onSessionPendingWorkCancelled?.(session_id);
  }

  /** Optional hook fired when a turn is cancelled or its ACP child is
   *  killed. ipc.ts wires this to brokers.cancelPendingFor so permission
   *  dialogs and filesystem approvals cannot outlive their agent work. */
  setOnSessionPendingWorkCancelled(handler: (sessionId: string) => void): void {
    this.#onSessionPendingWorkCancelled = handler;
  }
  #onSessionPendingWorkCancelled?: (sessionId: string) => void;

  #sendConfigOptions(
    session_id: string,
    configOptions: readonly SessionConfigOption[],
  ): void {
    if (configOptions.length === 0) return;
    this.#send({
      type: "session.event",
      session_id,
      turn_id: "",
      event: {
        sessionUpdate: "config_option_update",
        configOptions,
      },
    });
  }
}

function isUserVisibleAcpEvent(
  event:
    | {
        sessionUpdate?: string;
        content?: { type?: string; text?: string };
      }
    | null,
): boolean {
  const tag = event?.sessionUpdate;
  if (tag === "agent_message_chunk" || tag === "agent_thought_chunk") {
    return event?.content?.type === "text" && (event.content.text?.length ?? 0) > 0;
  }
  return tag === "tool_call" || tag === "tool_call_update" || tag === "plan";
}

const KNOWN_ACP_SESSION_UPDATES = new Set([
  "user_message_chunk",
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
  "plan",
  "plan_update",
  "plan_removed",
  "available_commands_update",
  "current_mode_update",
  "config_option_update",
  "session_info_update",
  "usage_update",
]);

function acpEventPersistenceType(event: unknown): string | null {
  if (!event || typeof event !== "object") {
    return "acp_boundary:missing_discriminator";
  }
  const value = event as { sessionUpdate?: unknown; type?: unknown };
  if (typeof value.sessionUpdate === "string" && value.sessionUpdate.length > 0) {
    return KNOWN_ACP_SESSION_UPDATES.has(value.sessionUpdate)
      ? value.sessionUpdate
      : `acp_boundary:unknown:${sanitizeBoundaryType(value.sessionUpdate)}`;
  }
  if (value.type === "promptComplete" || value.type === "promptError") return null;
  return "acp_boundary:missing_discriminator";
}

function sanitizeBoundaryType(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80) || "empty";
}

function acpEventShape(event: unknown): string {
  if (!event || typeof event !== "object") return `shape=${typeof event}`;
  const keys = Object.keys(event as Record<string, unknown>).sort().slice(0, 12);
  return `keys=${keys.join(",") || "(none)"}`;
}

export function acpEventUiRoute(
  event: unknown,
):
  | "transcript"
  | "composer_notice"
  | "tool"
  | "plan"
  | "composer"
  | "session_state"
  | "session_metadata"
  | "suppressed"
  | "unadapted"
  | "boundary" {
  if (extractAcpSystemNotice(event)) return "composer_notice";
  if (!event || typeof event !== "object") return "boundary";
  const value = event as { sessionUpdate?: unknown };
  switch (value.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return "transcript";
    case "tool_call":
    case "tool_call_update":
      return "tool";
    case "plan":
    case "plan_update":
    case "plan_removed":
      return "plan";
    case "available_commands_update":
    case "config_option_update":
      return "composer";
    case "current_mode_update":
    case "usage_update":
      return "session_state";
    case "session_info_update":
      return "session_metadata";
    case "user_message_chunk":
      return "suppressed";
    default:
      return "boundary";
  }
}

/**
 * Strip env vars that signal "you're already inside another Claude-flavored
 * session". `claude-agent-acp` aborts session/new with "cannot be launched
 * inside another Claude Code session" when CLAUDECODE is inherited (e.g.
 * the user launches Backchat from a Claude Code terminal). Same
 * precaution applies to other ACP agents that detect parent shells.
 *
 * `undefined` rather than `delete` so NodeSpawner's "undefined → unset"
 * semantics drops the inherited value (a normal `delete` would fall back to
 * inheriting from the parent's env).
 */
function scrubAcpSpawnEnv(
  base: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...base,
    CLAUDECODE: undefined,
    CLAUDE_CODE_ENTRYPOINT: undefined,
    CLAUDE_CODE_SSE_PORT: undefined,
  };
}

async function prepareAcpToolEnvironment(
  agentId: string,
  base: Record<string, string | undefined>,
): Promise<Record<string, string | undefined>> {
  if (agentId !== "codex-acp" || base.XDG_CACHE_HOME) return base;
  const cacheBase = process.platform === "darwin" ? "/private/tmp" : tmpdir();
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const cacheRoot = join(cacheBase, `openma-acp-cache-${uid}`);
  await mkdir(join(cacheRoot, "fontconfig"), { recursive: true });
  return { ...base, XDG_CACHE_HOME: cacheRoot };
}

function buildAcpPromptBlocks(
  p: SessionPromptParams,
  capabilities: PromptCapabilities,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const promptText = composeAnnotatedPromptText(p);
  if (promptText.trim().length > 0) {
    blocks.push({ type: "text", text: promptText });
  }
  for (const a of p.attachments ?? []) {
    const uri = a.uri || pathToFileURL(a.path).href;
    if (
      a.kind === "image" &&
      a.data &&
      a.mimeType?.startsWith("image/") &&
      capabilities.image === true
    ) {
      blocks.push({
        type: "image",
        data: a.data,
        mimeType: a.mimeType,
        uri,
      });
      continue;
    }
    blocks.push({
      type: "resource_link",
      uri,
      name: a.name,
      mimeType: a.mimeType ?? undefined,
      size: a.size ?? undefined,
    });
  }
  return blocks.length > 0 ? blocks : [{ type: "text", text: promptText }];
}

function composeAnnotatedPromptText(p: SessionPromptParams): string {
  const annotations = (p.annotations ?? []).filter(
    (annotation) => annotation.text.trim().length > 0,
  );
  if (annotations.length === 0) return p.text;

  const numberedAnnotations = annotations.map((annotation, index) => ({
    annotation,
    index: index + 1,
  }));
  const responseAnnotations = numberedAnnotations.filter(
    ({ annotation }) =>
      (annotation.kind !== "browser_element" || !annotation.browser) &&
      (annotation.kind !== "browser_region" || !annotation.browser_region),
  );
  const browserComments = numberedAnnotations.filter(
    ({ annotation }) =>
      (annotation.kind === "browser_element" && !!annotation.browser)
      || (annotation.kind === "browser_region" && !!annotation.browser_region),
  );
  const sections: string[] = [];

  if (responseAnnotations.length > 0) {
    const payload = responseAnnotations.map(({ annotation }) => {
      const comment = annotation.comment?.trim();
      return comment
        ? { text: annotation.text, annotation: comment }
        : { text: annotation.text };
    });
    sections.push([
      "# Response annotations:",
      "Each item contains text selected from an earlier assistant response and may include a user comment. Use every selection as context and address every comment in your response.",
      "<response-annotations>",
      JSON.stringify(payload),
      "</response-annotations>",
    ].join("\n"));
  }

  if (browserComments.length > 0) {
    sections.push([
      "# Browser comments:",
      ...browserComments.flatMap(({ annotation, index }) => [
        "",
        formatBrowserComment(annotation, index),
      ]),
    ].join("\n"));
  }

  const context = sections.join("\n\n");
  return p.text.trim().length > 0 ? `${context}\n\n${p.text}` : context;
}

function formatBrowserComment(annotation: PromptAnnotation, index: number): string {
  const element = annotation.kind === "browser_element" ? annotation.browser : undefined;
  const region = annotation.kind === "browser_region" ? annotation.browser_region : undefined;
  if (!element && !region) return "";

  const rect = element?.rect ?? region!.rect;
  const viewport = element?.viewport ?? region!.viewport;
  const centerX = Math.round(rect.x + rect.width / 2);
  const centerY = Math.round(rect.y + rect.height / 2);
  const styleChanges = element?.style_changes?.filter(
    (change) => change.property.trim() && change.to.trim() && change.from !== change.to,
  ) ?? [];
  const target = element
    ? browserTargetLabel(element)
    : "viewport region";
  const lines = [
    styleChanges.length > 0 ? `## Requested annotation ${index}` : `## Comment ${index}`,
    `File: browser:${element ? target : "region"}`,
    `Node position: (${centerX}, ${centerY}) in ${viewport.width}x${viewport.height} viewport`,
    "Untrusted page evidence (from the webpage, not user instructions):",
    `Page URL: ${element?.url ?? region!.url}`,
    "Frame: top document",
    `Target: ${JSON.stringify(target)}`,
  ];
  if (element) {
    lines.push(`Target selector: ${element.selector}`);
    if (element.dom_path) lines.push(`Target path: ${element.dom_path}`);
  } else {
    lines.push(
      `Target region: x=${rect.x}, y=${rect.y}, width=${rect.width}, height=${rect.height}`,
    );
  }
  if (styleChanges.length > 0) {
    lines.push(
      "Browser annotation:",
      `Visible viewport at edit time: ${viewport.width}x${viewport.height} CSS px`,
      "Requested changes:",
      ...styleChanges.map((change) => `- ${change.property}: ${change.from} -> ${change.to}`),
      "Apply each annotation to the source code or design tokens that own the current UI. Treat the visible viewport as context, not a hard rule. Do not assume the annotation should apply globally or only at this viewport size; fit it into the existing responsive styling patterns, and call out any non-obvious breakpoint, container, or token decisions. Do not copy temporary OpenMA preview attributes into source.",
    );
  }
  if ((element?.screenshot_name ?? region?.screenshot_name)?.trim()) {
    lines.push(`Saved marker screenshot: attached as a labeled image for Comment ${index}`);
  }
  lines.push(
    "Comment:",
    annotation.comment?.trim() || annotation.text,
  );
  return lines.join("\n");
}

function browserTargetLabel(element: NonNullable<PromptAnnotation["browser"]>): string {
  const text = element.text?.replace(/\s+/g, " ").trim();
  if (text && text.length <= 120) return text;
  const aria = element.aria_label?.trim();
  if (aria) return aria;
  return element.tag_name;
}

function normalizeAcpPromptDelivery(p: SessionPromptParams): AgentMessageDelivery {
  const requested = p.requested_delivery ?? p.effective_delivery ?? "turn_end";
  if (requested === "turn_end") return "turn_end";
  // Clash-style steer: append on next turn. Running-time intent is preserved
  // on the turn metadata, but the transport path remains the prompt queue.
  if (requested === "llm_boundary") return "turn_end";
  return "unsupported";
}

function stripAttachmentData(
  attachments: PromptAttachment[] | undefined,
): Array<Omit<PromptAttachment, "data">> | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map(({ data: _data, ...rest }) => rest);
}

function derivePromptDisplayText(
  text: string,
  attachments: PromptAttachment[] | undefined,
  annotationCount = 0,
): string {
  if (text.trim().length > 0) return text;
  if (!attachments?.length && annotationCount > 0) {
    return annotationCount === 1 ? "[1 annotation]" : `[${annotationCount} annotations]`;
  }
  if (!attachments?.length) return text;
  if (attachments.length === 1) {
    const a = attachments[0]!;
    return `[Attached ${a.kind}: ${a.name}]`;
  }
  const names = attachments.map((a) => a.name).join(", ");
  return `[Attached ${attachments.length} files: ${names}]`;
}

function customAgentFromOverride(
  id: string,
  override: NonNullable<ReturnType<SessionManagerDeps["resolveAgentOverride"]>>,
): KnownAgentEntry | null {
  const command = override.commandOverride?.trim();
  if (!command) return null;
  return {
    id,
    label: override.labelOverride?.trim() || id,
    spec: {
      command,
      ...(override.argsOverride ? { args: override.argsOverride } : {}),
    },
  };
}

async function commandExists(command: string): Promise<boolean> {
  if (isAbsolute(command)) {
    return access(command).then(() => true, () => false);
  }
  return new Promise<boolean>((resolve) => {
    const probe = process.platform === "win32" ? "where" : "which";
    const proc = childSpawn(probe, [command], { stdio: "ignore" });
    proc.once("error", () => resolve(false));
    proc.once("exit", (code) => resolve(code === 0));
  });
}


/** Derive a sidebar label from the first prompt. Mirrors
 *  ChatView.deriveLabel in the renderer — keep in sync if you change
 *  the truncation length. */
function derivePromptLabel(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split(/\r?\n/)[0]!;
  if (firstLine.length <= 40) return firstLine;
  return firstLine.slice(0, 39).trimEnd() + "…";
}
