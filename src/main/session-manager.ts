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
import { AcpRuntimeImpl, type AcpSession, type ClientCallbacks } from "@open-managed-agents-desktop/acp";
import { NodeSpawner } from "@open-managed-agents-desktop/acp/node-spawner";
import { resolveKnownAgent } from "@open-managed-agents-desktop/acp/registry";
import type { SessionEventOut, SessionStartParams, SessionPromptParams } from "../shared/session-events.js";
import { ensureSessionCwd, removeSessionCwd } from "./session-cwd.js";

export type Sender = (msg: SessionEventOut) => void;

interface ActiveSession {
  acp: AcpSession;
  acpSessionId: string;
  agentId: string;
  cwd: string;
  /** Live turns keyed by turn_id. abort() cancels the ACP request and unwinds
   *  the prompt() async iterator. */
  turns: Map<string, AbortController>;
}

export interface SessionManagerDeps {
  send: Sender;
  /** Build the per-session ACP McpServer[] for `session/new`. Returns the
   *  user's globally-configured servers (from settings, see Phase 8 for the
   *  per-agent override matrix). */
  resolveMcpServers: (agentId: string) => unknown[];
  /** Per-session client callbacks (permission/fs/terminal). Returned object's
   *  identity changes per session — each call yields a closure bound to the
   *  given session_id so brokers know which window to dispatch to. */
  buildCallbacks: (sessionId: string) => ClientCallbacks;
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

    // Cwd resolution: caller > settings default > userData fallback. The
    // last branch creates a per-session dir under userData/sessions which
    // outlives the daemon (resume-friendly, see session-cwd.ts).
    const sessionCwd =
      p.cwd ?? defaults.cwd ?? (await ensureSessionCwd(p.session_id));

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
        clientCallbacks: this.#buildCallbacks(p.session_id),
      });
      this.#sessions.set(p.session_id, {
        acp: acpSession,
        acpSessionId: acpSession.acpSessionId,
        agentId: agent.id,
        cwd: sessionCwd,
        turns: new Map(),
      });
      this.#send({
        type: "session.ready",
        session_id: p.session_id,
        acp_session_id: acpSession.acpSessionId,
        agent_id: agent.id,
        cwd: sessionCwd,
      });
    } catch (e) {
      this.#send({
        type: "session.error",
        session_id: p.session_id,
        message: e instanceof Error ? e.message : String(e),
      });
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
    const ctrl = new AbortController();
    sess.turns.set(p.turn_id, ctrl);
    let promptErr: string | null = null;
    try {
      for await (const ev of sess.acp.prompt(p.text, { abortSignal: ctrl.signal })) {
        if (ctrl.signal.aborted) break;
        // AcpSession yields synthetic sentinel events at end-of-stream:
        //   { type: "promptComplete", response }  → ACP returned cleanly
        //   { type: "promptError",    error }     → ACP returned an error
        // The latter often carries the only signal that the turn failed
        // (wrong model id, auth missing). Forward as session.error.
        const t = (ev as { type?: string } | null | undefined)?.type;
        if (t === "promptComplete") continue;
        if (t === "promptError") {
          promptErr = (ev as { error?: string }).error ?? "ACP prompt error (no message)";
          continue;
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
  }
}

/**
 * Strip env vars that signal "you're already inside another Claude-flavored
 * session". `claude-agent-acp` aborts session/new with "cannot be launched
 * inside another Claude Code session" when CLAUDECODE is inherited (e.g.
 * the user launches openma-desktop from a Claude Code terminal). Same
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
