/**
 * AcpSession — owns one ACP child + its ClientSideConnection.
 *
 * Translates the SDK's request/response + notification model into a single
 * AsyncIterable<event> per turn:
 *   - sessionUpdate notifications pile into a queue while
 *     `agent.prompt()` is in flight;
 *   - the iterator drains the queue, ending when prompt resolves;
 *   - sentinel events `promptComplete` / `promptError` fire at the end.
 *
 * Vendored from @open-managed-agents/acp-runtime (Apache-2.0). Edits relative
 * to upstream:
 *   - Client callbacks (permission, fs/*, terminal/*) delegate to host-injected
 *     `ClientCallbacks`. Default fallbacks: permission denies, file/terminal
 *     hooks throw — the agent surfaces those as errors in the stream.
 *   - Updated for SDK 0.23 method names (createTerminal / terminalOutput /
 *     releaseTerminal / waitForTerminalExit / killTerminal).
 */

import {
  ClientSideConnection,
  ndJsonStream,
  type Agent,
  type Client,
} from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import type { AcpSession, ChildHandle, ClientCallbacks, SessionOptions } from "./types.js";

interface ConstructDeps {
  child: ChildHandle;
  options: SessionOptions;
  id: string;
}

export class AcpSessionImpl implements AcpSession {
  readonly id: string;
  readonly options: SessionOptions;

  get acpSessionId(): string {
    return this.#sessionId ?? "";
  }

  #child: ChildHandle;
  #agent!: Agent;
  #sessionId!: string;
  #disposed = false;
  #activePromptCount = 0;
  #pendingEvents: unknown[] = [];
  #waiters: Array<(v: IteratorResult<unknown>) => void> = [];
  #authMethods: readonly schema.AuthMethod[] = [];
  #agentInfo: schema.Implementation | null = null;
  #configOptions: readonly schema.SessionConfigOption[] = [];
  #promptCapabilities: schema.PromptCapabilities = {};
  #supportsSessionFork = false;

  constructor(deps: ConstructDeps) {
    this.id = deps.id;
    this.options = deps.options;
    this.#child = deps.child;
  }

  async init(): Promise<void> {
    const initStartedAt = Date.now();
    const stream = ndJsonStream(this.#child.stdin, this.#child.stdout);
    const cb: ClientCallbacks = this.options.clientCallbacks ?? {};

    const client: Client = {
      sessionUpdate: async (params) => {
        // ACP wraps every streamed update in a SessionNotification:
        //   { sessionId, update: { sessionUpdate: "agent_message_chunk", … } }
        // Push only the inner `update` to the consumer — the session id is
        // already known from the AcpSession instance, so the wrapper just
        // forces every consumer to do a redundant `.update.foo` indirection.
        const inner = (params as { update?: unknown })?.update;
        const update = inner !== undefined ? inner : params;
        if (this.#activePromptCount === 0 && !isIdleSessionUpdate(update)) {
          return;
        }
        this.#pushEvent(update);
      },
      requestPermission: async (params) => {
        if (cb.requestPermission) {
          try {
            return await cb.requestPermission(params);
          } catch (e) {
            this.#pushEvent({ type: "requestPermissionError", error: String(e) });
            return { outcome: { outcome: "cancelled" } };
          }
        }
        // No host handler → deny. Agent will surface "cancelled" to the user.
        return { outcome: { outcome: "cancelled" } };
      },
      readTextFile: cb.readTextFile
        ? async (params) => cb.readTextFile!(params)
        : undefined,
      writeTextFile: cb.writeTextFile
        ? async (params) => cb.writeTextFile!(params)
        : undefined,
      createTerminal: cb.createTerminal
        ? async (params) => cb.createTerminal!(params)
        : undefined,
      terminalOutput: cb.terminalOutput
        ? async (params) => cb.terminalOutput!(params)
        : undefined,
      releaseTerminal: cb.releaseTerminal
        ? async (params) => cb.releaseTerminal!(params)
        : undefined,
      waitForTerminalExit: cb.waitForTerminalExit
        ? async (params) => cb.waitForTerminalExit!(params)
        : undefined,
      killTerminal: cb.killTerminal
        ? async (params) => cb.killTerminal!(params)
        : undefined,
    };

    const conn = new ClientSideConnection(() => client, stream);
    this.#agent = conn;

    const initResult = await this.#agent.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: !!cb.readTextFile,
          writeTextFile: !!cb.writeTextFile,
        },
        terminal: !!cb.createTerminal,
      },
    });
    const initializedAt = Date.now();

    // Stash the agent's advertised authMethods so the host can drive a
    // user-initiated "sign in / switch account" flow via
    // `authenticate()` below. We deliberately do NOT pre-emptively
    // pick a method here — `authMethods` is the catalog of supported
    // signin modes (gemini-cli returns all four unconditionally),
    // not "you need to auth right now". newSession will fail with a
    // real error if the agent actually needs credentials; the host
    // surfaces that to the user and offers Settings → Re-sign-in.
    this.#authMethods = initResult.authMethods ?? [];
    this.#agentInfo = initResult.agentInfo ?? null;
    this.#promptCapabilities = initResult.agentCapabilities?.promptCapabilities ?? {};
    this.#supportsSessionFork =
      initResult.agentCapabilities?.sessionCapabilities?.fork != null;

    const wantsFork = this.options.forkFromAcpSessionId;
    if (wantsFork) {
      if (!this.#supportsSessionFork || !this.#agent.unstable_forkSession) {
        throw new Error("ACP agent does not support unstable session/fork");
      }
      const forked = await this.#agent.unstable_forkSession({
        sessionId: wantsFork,
        cwd: this.options.agent.cwd ?? process.cwd(),
        mcpServers: this.options.mcpServers ?? [],
      });
      this.#sessionId = forked.sessionId;
      this.#configOptions = forked.configOptions ?? [];
      this.#logInitPhases("fork", initStartedAt, initializedAt);
      return;
    }

    const wantsResume = this.options.resumeAcpSessionId;
    const supportsLoad = initResult.agentCapabilities?.loadSession === true;

    if (wantsResume && supportsLoad && this.#agent.loadSession) {
      try {
        const loaded = await this.#agent.loadSession({
          sessionId: wantsResume,
          cwd: this.options.agent.cwd ?? process.cwd(),
          mcpServers: this.options.mcpServers ?? [],
        });
        this.#sessionId = wantsResume;
        this.#configOptions = loaded.configOptions ?? [];
        this.#logInitPhases("load", initStartedAt, initializedAt);
        return;
      } catch (e) {
        // Resume failed — fall through to fresh session. Caller surfaces
        // the lost history.
        // eslint-disable-next-line no-console
        console.error(`[acp] session/load(${wantsResume}) failed, falling back to new:`, e);
      }
    }

    const newSession = await this.#agent.newSession({
      cwd: this.options.agent.cwd ?? process.cwd(),
      mcpServers: this.options.mcpServers ?? [],
    });
    this.#sessionId = newSession.sessionId;
    this.#configOptions = newSession.configOptions ?? [];
    this.#logInitPhases("new", initStartedAt, initializedAt);
  }

  #logInitPhases(
    openMode: "new" | "load" | "fork",
    initStartedAt: number,
    initializedAt: number,
  ): void {
    if (process.env.NODE_ENV === "test") return;
    const completedAt = Date.now();
    process.stderr.write(
      `[acp-init] id=${this.id} mode=${openMode} initialize_ms=${initializedAt - initStartedAt} session_open_ms=${completedAt - initializedAt} total_ms=${completedAt - initStartedAt}\n`,
    );
  }

  /** The agent's advertised auth methods (from `initialize.authMethods`).
   *  Empty when the agent doesn't ship any — usually means "no auth
   *  needed". Settings UI reads this to render the per-agent sign-in
   *  panel. */
  get authMethods(): readonly schema.AuthMethod[] {
    return this.#authMethods;
  }

  /** Display name / version reported by the agent on initialize. */
  get agentInfo(): schema.Implementation | null {
    return this.#agentInfo;
  }

  get configOptions(): readonly schema.SessionConfigOption[] {
    return this.#configOptions;
  }

  get promptCapabilities(): schema.PromptCapabilities {
    return this.#promptCapabilities;
  }

  get supportsSessionFork(): boolean {
    return this.#supportsSessionFork;
  }

  /** Drive a user-initiated signin step. Settings → "Sign in / switch
   *  account" calls this with the method id picked by the user; the
   *  agent does its own sub-flow (OAuth browser handoff, API-key
   *  validation, …) and resolves once done. Throws the agent's error
   *  raw on failure — caller surfaces it. */
  async authenticate(methodId: string): Promise<void> {
    if (!this.#agent) throw new Error("AcpSession not initialized");
    await this.#agent.authenticate({ methodId });
  }

  /** Switch the agent session into a specific mode (e.g. codex's
   *  `read-only` / `auto` / `full-access`). Returns silently when the
   *  agent doesn't support setSessionMode at all — older / minimal
   *  adapters can be ignored, the caller already accepted that risk
   *  by trying to set a mode.
   *
   *  Codex defaults a new session to `read-only`, which forbids any
   *  sandboxed exec (and therefore the `imagegen` MCP skill, etc).
   *  Backchat's "auto" / "full access" permission_mode setting needs
   *  to call through here on session boot or the user sees the agent
   *  hallucinate ("已生成") instead of actually invoking the tool. */
  async setMode(modeId: string): Promise<void> {
    if (!this.#agent || !this.#sessionId) {
      throw new Error("AcpSession not initialized");
    }
    // Optional method — older SDK versions don't have it. Older
    // adapters might not implement it either; either way we treat
    // absence as "fine, no-op".
    const setSessionMode = (this.#agent as { setSessionMode?: (p: unknown) => Promise<unknown> })
      .setSessionMode;
    if (typeof setSessionMode !== "function") return;
    try {
      await setSessionMode.call(this.#agent, {
        sessionId: this.#sessionId,
        modeId,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[acp] setSessionMode("${modeId}") failed:`, e);
    }
  }

  async setConfigOption(
    configId: string,
    value: string | boolean,
  ): Promise<readonly schema.SessionConfigOption[]> {
    if (!this.#agent || !this.#sessionId) {
      throw new Error("AcpSession not initialized");
    }
    const setSessionConfigOption = (
      this.#agent as {
        setSessionConfigOption?: (p: schema.SetSessionConfigOptionRequest) =>
          Promise<schema.SetSessionConfigOptionResponse>;
      }
    ).setSessionConfigOption;
    if (typeof setSessionConfigOption !== "function") {
      throw new Error("ACP agent does not support session config options");
    }
    const response = await setSessionConfigOption.call(this.#agent, {
      sessionId: this.#sessionId,
      configId,
      ...(typeof value === "boolean" ? { type: "boolean" as const, value } : { value }),
    });
    this.#configOptions = response.configOptions ?? [];
    return this.#configOptions;
  }

  prompt(
    input: string | readonly schema.ContentBlock[],
    opts?: { abortSignal?: AbortSignal },
  ): AsyncIterable<unknown> {
    if (this.#disposed) {
      throw new Error(`AcpSession ${this.id} is disposed`);
    }
    return this.#promptIter(input, opts);
  }

  drainPendingEvents(): unknown[] {
    if (this.#pendingEvents.length === 0) return [];
    return this.#pendingEvents.splice(0);
  }

  async *#promptIter(
    input: string | readonly schema.ContentBlock[],
    opts?: { abortSignal?: AbortSignal },
  ): AsyncIterable<unknown> {
    const onAbort = () => {
      this.#agent
        .cancel({ sessionId: this.#sessionId })
        .catch(() => { /* best effort */ });
    };
    opts?.abortSignal?.addEventListener("abort", onAbort, { once: true });

    const turnAbort = new AbortController();
    const turnTimer = this.options.perTurnTimeoutMs
      ? setTimeout(() => turnAbort.abort(), this.options.perTurnTimeoutMs)
      : null;
    if (opts?.abortSignal) {
      opts.abortSignal.addEventListener("abort", () => turnAbort.abort(), { once: true });
    }
    turnAbort.signal.addEventListener("abort", onAbort, { once: true });

    this.#activePromptCount += 1;
    const prompt =
      typeof input === "string"
        ? [{ type: "text" as const, text: input }]
        : [...input];
    const promptDone = this.#agent
      .prompt({
        sessionId: this.#sessionId,
        prompt,
      })
      .finally(() => {
        this.#activePromptCount = Math.max(0, this.#activePromptCount - 1);
        if (turnTimer) clearTimeout(turnTimer);
        opts?.abortSignal?.removeEventListener("abort", onAbort);
      });

    let ended = false;
    promptDone.then(
      (response) => {
        ended = true;
        this.#pushEvent({ type: "promptComplete", response });
        this.#endStream();
      },
      (err) => {
        ended = true;
        this.#pushEvent({ type: "promptError", error: String(err) });
        this.#endStream();
      },
    );

    while (true) {
      if (this.#pendingEvents.length > 0) {
        const ev = this.#pendingEvents.shift();
        yield ev;
        continue;
      }
      if (ended) break;
      await new Promise<void>((resolve) => {
        this.#waiters.push(() => resolve());
      });
    }

    // Surface a thrown prompt as a real reject so callers can `try/catch`
    // around `for await`.
    await promptDone;
  }

  isAlive(): boolean {
    return !this.#disposed;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#endStream();
    await this.#child.kill("SIGTERM").catch(() => { /* already gone */ });
  }

  #pushEvent(ev: unknown): void {
    this.#pendingEvents.push(ev);
    const w = this.#waiters.shift();
    w?.({ value: undefined, done: false });
  }

  #endStream(): void {
    while (this.#waiters.length > 0) {
      this.#waiters.shift()!({ value: undefined, done: true });
    }
  }
}

const IDLE_SESSION_UPDATES = new Set([
  "available_commands_update",
  "current_mode_update",
  "config_option_update",
  "session_info_update",
]);

function isIdleSessionUpdate(update: unknown): boolean {
  const tag = (update as { sessionUpdate?: unknown } | null)?.sessionUpdate;
  return typeof tag === "string" && IDLE_SESSION_UPDATES.has(tag);
}
