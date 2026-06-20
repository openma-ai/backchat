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
import { pathToFileURL } from "node:url";
import {
  AcpRuntimeImpl,
  type AcpSession,
  type ClientCallbacks,
  type ContentBlock,
  type PromptCapabilities,
} from "@open-managed-agents-desktop/acp";
import { NodeSpawner } from "@open-managed-agents-desktop/acp/node-spawner";
import { resolveKnownAgent } from "@open-managed-agents-desktop/acp/registry";
import { ensureLatestAcpBinary } from "@open-managed-agents-desktop/acp/binary-update";
import type {
  PromptAttachment,
  SessionConfigOption,
  SessionEventOut,
  SessionPromptParams,
  SessionSetConfigOptionParams,
  SessionStartParams,
} from "../shared/session-events.js";
import { ensureSessionCwd, removeSessionCwd } from "./session-cwd.js";
import {
  appendEvent,
  archiveSession,
  setSessionTitleIfEmpty,
  touchSession,
  upsertSession,
} from "./sql-store.js";

export type Sender = (msg: SessionEventOut) => void;

interface ActiveSession {
  acp: AcpSession;
  acpSessionId: string;
  agentId: string;
  cwd: string;
  /** Live turns keyed by turn_id. abort() cancels the ACP request and unwinds
   *  the prompt() async iterator. */
  turns: Map<string, AbortController>;
  promptQueue: QueuedPrompt[];
  promptQueueActive: boolean;
}

interface QueuedPrompt {
  params: SessionPromptParams;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export interface SessionManagerDeps {
  send: Sender;
  /** Build the per-session ACP McpServer[] for `session/new`. Returns the
   *  user's globally-configured servers (from settings, see Phase 8 for the
   *  per-agent override matrix). */
  resolveMcpServers: (agentId: string) => unknown[];
  /** Per-session client callbacks (permission/fs/terminal). Returned object's
   *  identity changes per session — each call yields a closure bound to the
   *  given session_id so brokers know which window to dispatch to. The
   *  spawn cwd is passed so the fs broker can scope "inside cwd → auto
   *  allow" without re-deriving the path. */
  buildCallbacks: (sessionId: string, sessionCwd: string) => ClientCallbacks;
  /** Settings-driven defaults consulted when `start()` arrives without an
   *  agent_id or cwd. Returning empty / undefined falls back to the
   *  registry overlay defaults (first detected agent for agent_id;
   *  ensureSessionCwd for cwd).
   *
   *  `agentOverride` lets per-agent config (custom command, extra env)
   *  reach the spawn step. Settings/Agents UI populates this. */
  resolveDefaults: () => {
    agentId?: string;
    cwd?: string;
    permissionMode?: "ask" | "auto" | "read_only";
  };
  resolveAgentOverride: (
    agentId: string,
  ) =>
    | {
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

  has(id: string): boolean {
    return this.#sessions.has(id);
  }

  sessionCount(): number {
    return this.#sessions.size;
  }

  /** Spin up a throwaway AcpSession for the named agent JUST long enough
   *  to read its `initialize.authMethods` list. Disposed before returning.
   *
   *  Used by Settings → Agents to render the per-agent sign-in picker.
   *  Lives on SessionManager rather than ipc.ts so we reuse the spawner +
   *  runtime + agent override resolution (custom command, env vars) that
   *  start() already wired up — keeps the "what binary actually runs"
   *  logic in one place. */
  async probeAuthMethods(agentId: string): Promise<{
    methods: ReadonlyArray<{ id: string; name: string; description?: string | null; type?: string | undefined }>;
    agentName: string | null;
  }> {
    const sess = await this.#openOneShot(agentId);
    try {
      return {
        methods: sess.authMethods.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description ?? null,
          type: (m as { type?: string }).type,
        })),
        agentName:
          sess.agentInfo?.title ?? sess.agentInfo?.name ?? null,
      };
    } finally {
      await sess.dispose().catch(() => undefined);
    }
  }

  /** User-initiated sign-in. Spawns a one-shot AcpSession and invokes
   *  the agent's authenticate sub-flow (OAuth browser handoff for
   *  oauth-personal, API-key validation for the env_var variants).
   *  Disposed regardless of outcome — keyring/file state the agent
   *  wrote is what persists. */
  async authenticateAgent(agentId: string, methodId: string): Promise<void> {
    const sess = await this.#openOneShot(agentId);
    try {
      await sess.authenticate(methodId);
    } finally {
      await sess.dispose().catch(() => undefined);
    }
  }

  async #openOneShot(agentId: string) {
    const agent = resolveKnownAgent(agentId);
    if (!agent) throw new Error(`unknown ACP agent: ${agentId}`);
    const override = this.#resolveAgentOverride(agent.id) ?? {};
    const command = override.commandOverride || agent.spec.command;
    const args = override.argsOverride ?? agent.spec.args;
    return this.#runtime.start({
      agent: {
        command,
        args,
        cwd: process.cwd(),
        env: scrubAcpSpawnEnv({
          ...(agent.spec.env ?? {}),
          ...(override.envOverride ?? {}),
        }),
      },
      mcpServers: [],
      // No client callbacks — auth flows shouldn't try to call back
      // into permission / fs / terminal handlers. If an agent does
      // require those during signin, we'll surface the failure and
      // revisit the contract then.
    });
  }

  /** Re-announce alive sessions — used by the renderer's mount handshake so a
   *  reload sees what's running. */
  announceAll(): void {
    for (const [session_id, sess] of this.#sessions) {
      this.#send({
        type: "session.ready",
        session_id,
        acp_session_id: sess.acpSessionId,
        agent_id: sess.agentId,
        cwd: sess.cwd,
      });
    }
  }

  async start(p: SessionStartParams): Promise<void> {
    // Idempotent re-ack.
    const existing = this.#sessions.get(p.session_id);
    if (existing) {
      this.#send({
        type: "session.ready",
        session_id: p.session_id,
        acp_session_id: existing.acpSessionId,
        agent_id: existing.agentId,
        cwd: existing.cwd,
      });
      return;
    }

    // Resolve agent: caller-provided id wins; otherwise fall back to the
    // settings-level default; otherwise nothing — surface a useful error
    // ("set a default in Settings → Agents") instead of a cryptic "unknown
    // agent: ".
    const defaults = this.#resolveDefaults();
    const requestedAgentId = p.agent_id || defaults.agentId || "";
    if (!requestedAgentId) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        message:
          "No default agent configured. Open Settings → Agents and pick a default.",
      });
      return;
    }
    const agent = resolveKnownAgent(requestedAgentId);
    if (!agent) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        message: `unknown ACP agent: ${requestedAgentId}`,
      });
      return;
    }

    // Apply per-agent overrides from settings — lets the user point at a
    // custom binary path or inject env vars (ANTHROPIC_API_KEY etc.) per
    // agent without touching the registry.
    const override = this.#resolveAgentOverride(agent.id) ?? {};
    const command = override.commandOverride || agent.spec.command;
    const args = override.argsOverride ?? agent.spec.args;

    // Verify binary is on PATH. Defense in depth: detectAll() should have
    // gated the picker, but the user could uninstall between picker and
    // start. Surface a clean error with the install hint instead of letting
    // child_process throw an unhelpful ENOENT.
    const onPath = await new Promise<boolean>((resolve) => {
      const probe = process.platform === "win32" ? "where" : "which";
      const proc = childSpawn(probe, [command], { stdio: "ignore" });
      proc.once("error", () => resolve(false));
      proc.once("exit", (code) => resolve(code === 0));
    });
    if (!onPath) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        message:
          `binary not on PATH for ${agent.id}: \`${command}\`` +
          (agent.installHint ? `. Install: ${agent.installHint}` : ""),
      });
      return;
    }

    // Cwd resolution: caller > settings default > managed-dir fallback.
    // The last branch creates a per-session dir under ~/.openma/sessions/
    // which outlives the daemon (resume-friendly, see session-cwd.ts).
    const sessionCwd =
      p.cwd ?? defaults.cwd ?? (await ensureSessionCwd(p.session_id));

    // Best-effort: pull the latest binary for this agent before we spawn,
    // so a user who hasn't manually upgraded a binary still gets fixes
    // shipped by the upstream adapter (e.g. codex-acp 0.14.0 added image
    // generation tool_call emission — without auto-update the user is
    // stuck on whatever they first installed). Runs at most once per
    // hour per agent_id; failures (network, permission, arch mismatch)
    // are swallowed and we fall through to spawning whatever is on disk.
    if (agent.spec.command === command) {
      await ensureLatestAcpBinary(agent.id, {
        registryVersion: agent.version,
        install: agent.install,
        command,
      }).catch(() => {
        /* swallowed — best-effort */
      });
    }

    try {
      const acpSession = await this.#runtime.start({
        agent: {
          command,
          args,
          cwd: sessionCwd,
          env: scrubAcpSpawnEnv({
            ...(agent.spec.env ?? {}),
            ...(override.envOverride ?? {}),
          }),
        },
        mcpServers: this.#resolveMcpServers(agent.id) as never,
        resumeAcpSessionId: p.resume?.acp_session_id,
        clientCallbacks: this.#buildCallbacks(p.session_id, sessionCwd),
      });
      this.#sessions.set(p.session_id, {
        acp: acpSession,
        acpSessionId: acpSession.acpSessionId,
        agentId: agent.id,
        cwd: sessionCwd,
        turns: new Map(),
        promptQueue: [],
        promptQueueActive: false,
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
      this.#send({
        type: "session.ready",
        session_id: p.session_id,
        acp_session_id: acpSession.acpSessionId,
        agent_id: agent.id,
        cwd: sessionCwd,
      });
      this.#sendConfigOptions(p.session_id, acpSession.configOptions);
    } catch (e) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async setConfigOption(p: SessionSetConfigOptionParams): Promise<void> {
    const sess = this.#sessions.get(p.session_id);
    if (!sess) {
      throw new Error("no such session");
    }
    const configOptions = await sess.acp.setConfigOption(p.config_id, p.value);
    this.#sendConfigOptions(p.session_id, configOptions);
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
    const effectiveDelivery = p.effective_delivery ?? "turn_end";
    if (effectiveDelivery !== "turn_end") {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        turn_id: p.turn_id,
        message: `delivery ${effectiveDelivery} is not supported by this ACP transport`,
      });
      return;
    }

    return new Promise<void>((resolve, reject) => {
      sess.promptQueue.push({ params: p, resolve, reject });
      void this.#drainPromptQueue(p.session_id, sess);
    });
  }

  async #drainPromptQueue(session_id: string, sess: ActiveSession): Promise<void> {
    if (sess.promptQueueActive) return;
    sess.promptQueueActive = true;
    try {
      while (sess.promptQueue.length > 0 && this.#sessions.get(session_id) === sess) {
        const item = sess.promptQueue.shift()!;
        try {
          await this.#runPromptNow(item.params, sess);
          item.resolve();
        } catch (e) {
          item.reject(e);
        }
      }
    } finally {
      sess.promptQueueActive = false;
      if (sess.promptQueue.length > 0 && this.#sessions.get(session_id) === sess) {
        void this.#drainPromptQueue(session_id, sess);
      }
    }
  }

  async #runPromptNow(p: SessionPromptParams, sess: ActiveSession): Promise<void> {
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
    // Persist the user prompt up front — even if the turn errors halfway,
    // we want the user's message in the log for replay.
    const displayText = derivePromptDisplayText(p.text, p.attachments);
    appendEvent(p.session_id, "user_prompt", {
      text: displayText,
      attachments: stripAttachmentData(p.attachments),
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
        if (ctrl.signal.aborted) break;
        const t = (ev as { type?: string } | null | undefined)?.type;
        if (t === "promptComplete") continue;
        if (t === "promptError") {
          promptErr = (ev as { error?: string }).error ?? "ACP prompt error (no message)";
          continue;
        }
        const ev2 = ev as { sessionUpdate?: string; content?: { type?: string; text?: string } } | null;
        const tag = ev2?.sessionUpdate;
        if (tag === "agent_message_chunk" || tag === "agent_thought_chunk") {
          const c = ev2?.content;
          if (c?.type === "text" && typeof c.text === "string") {
            if (tag === "agent_message_chunk") assistantText += c.text;
            else thoughtText += c.text;
          }
          // Persist the chunk immediately. If the app exits mid-turn, replay
          // still has every chunk that reached the main process.
          appendEvent(p.session_id, tag, ev);
        } else if (tag) {
          appendEvent(p.session_id, tag, ev);
        }
        this.#send({
          type: "session.event",
          session_id: p.session_id,
          turn_id: p.turn_id,
          event: ev,
        });
      }
      if (promptErr) {
        this.#send({
          type: "session.error",
          session_id: p.session_id,
          turn_id: p.turn_id,
          message: promptErr,
        });
      } else {
        this.#send({ type: "session.complete", session_id: p.session_id, turn_id: p.turn_id });
      }
    } catch (e) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        turn_id: p.turn_id,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
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

  cancel(session_id: string, turn_id: string): void {
    const sess = this.#sessions.get(session_id);
    if (!sess) return;
    sess.turns.get(turn_id)?.abort();
  }

  async dispose(session_id: string, opts?: { removeCwd?: boolean }): Promise<void> {
    await this.#killChild(session_id);
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
    const ids = [...this.#sessions.keys()];
    await Promise.all(ids.map((id) => this.#killChild(id)));
  }

  async #killChild(session_id: string): Promise<void> {
    const sess = this.#sessions.get(session_id);
    if (!sess) return;
    for (const ctrl of sess.turns.values()) ctrl.abort();
    await sess.acp.dispose().catch(() => undefined);
    this.#sessions.delete(session_id);
    // Unblock any pending permission / fs / terminal request for this
    // session — its ACP child is gone, no one will answer them.
    this.#onSessionGone?.(session_id);
  }

  /** Optional hook fired after a session's ACP child is killed. ipc.ts
   *  wires this to brokers.cancelPendingFor so any pending UI promises
   *  (permission modal, fs approval) unwind. */
  setOnSessionGone(handler: (sessionId: string) => void): void {
    this.#onSessionGone = handler;
  }
  #onSessionGone?: (sessionId: string) => void;

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

function buildAcpPromptBlocks(
  p: SessionPromptParams,
  capabilities: PromptCapabilities,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (p.text.trim().length > 0) {
    blocks.push({ type: "text", text: p.text });
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
  return blocks.length > 0 ? blocks : [{ type: "text", text: p.text }];
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
): string {
  if (!attachments?.length) return text;
  if (text.trim().length > 0) return text;
  if (attachments.length === 1) {
    const a = attachments[0]!;
    return `[Attached ${a.kind}: ${a.name}]`;
  }
  const names = attachments.map((a) => a.name).join(", ");
  return `[Attached ${attachments.length} files: ${names}]`;
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
