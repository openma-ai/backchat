/**
 * AcpSession — owns one ACP child + its ClientSideConnection.
 *
 * Translates the SDK's request/response + notification model into a single
 * AsyncIterable<event> per turn:
 *   - sessionUpdate notifications and synthetic `requestPermission` events
 *     pile into a queue while `agent.prompt()` is in flight;
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
  #pendingEvents: unknown[] = [];
  #waiters: Array<(v: IteratorResult<unknown>) => void> = [];

  constructor(deps: ConstructDeps) {
    this.id = deps.id;
    this.options = deps.options;
    this.#child = deps.child;
  }

  async init(): Promise<void> {
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
        // [debug] Dump every raw sessionUpdate notification at the
        // adapter boundary. If a tool_call / image content arrives here
        // but doesn't make it to session-manager's downstream tap, the
        // bug is between this push and the for-await consumer (queue,
        // backpressure, abort). Useful for diagnosing "renderer 丢东西".
        try {
          // eslint-disable-next-line no-console
          console.log(
            "[acp-session-rx]",
            JSON.stringify(inner !== undefined ? inner : params).slice(0, 600),
          );
        } catch {
          /* dbg log must not throw */
        }
        this.#pushEvent(inner !== undefined ? inner : params);
      },
      requestPermission: async (params) => {
        if (cb.requestPermission) {
          this.#pushEvent({ type: "requestPermission", params });
          try {
            return await cb.requestPermission(params);
          } catch (e) {
            this.#pushEvent({ type: "requestPermissionError", error: String(e) });
            return { outcome: { outcome: "cancelled" } };
          }
        }
        // No host handler → deny. Agent will surface "cancelled" to the user.
        this.#pushEvent({ type: "requestPermission", params, autoDenied: true });
        return { outcome: { outcome: "cancelled" } };
      },
      readTextFile: cb.readTextFile,
      writeTextFile: cb.writeTextFile,
      createTerminal: cb.createTerminal,
      terminalOutput: cb.terminalOutput,
      releaseTerminal: cb.releaseTerminal,
      waitForTerminalExit: cb.waitForTerminalExit,
      killTerminal: cb.killTerminal,
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

    const wantsResume = this.options.resumeAcpSessionId;
    const supportsLoad = initResult.agentCapabilities?.loadSession === true;

    if (wantsResume && supportsLoad && this.#agent.loadSession) {
      try {
        await this.#agent.loadSession({
          sessionId: wantsResume,
          cwd: this.options.agent.cwd ?? process.cwd(),
          mcpServers: this.options.mcpServers ?? [],
        });
        this.#sessionId = wantsResume;
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

  prompt(text: string, opts?: { abortSignal?: AbortSignal }): AsyncIterable<unknown> {
    if (this.#disposed) {
      throw new Error(`AcpSession ${this.id} is disposed`);
    }
    return this.#promptIter(text, opts);
  }

  async *#promptIter(text: string, opts?: { abortSignal?: AbortSignal }): AsyncIterable<unknown> {
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

    const promptDone = this.#agent
      .prompt({
        sessionId: this.#sessionId,
        prompt: [{ type: "text", text }],
      })
      .finally(() => {
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
