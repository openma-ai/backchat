import { readFile } from "node:fs/promises";
import { homedir, hostname, platform } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  decodeSessionCommand,
  encodeSessionHostEvent,
  initialSessionLifecycle,
  reduceSessionLifecycle,
  type SessionLifecycle,
  type SessionWireMessage,
} from "@openma/common/session-kernel";
import type {
  SessionEventOut,
  SessionPromptParams,
  SessionStartParams,
  SessionStartResult,
} from "../shared/session-events.js";

const OPEN = 1;
const HEARTBEAT_MS = 25_000;
const RECONNECT_MAX_MS = 60_000;

export function omaBridgeWebSocketUrl(serverUrl: string): string {
  const canonical = serverUrl.replace(
    /^https:\/\/openma\.dev(?=\/|$)/,
    "https://app.openma.dev",
  );
  const base = canonical
    .replace(/^http(s?):\/\//, "ws$1://")
    .replace(/\/$/, "");
  return `${base}/agents/runtime/_attach`;
}

export interface OmaBridgeCredentials {
  serverUrl: string;
  token: string;
  machineId: string;
}

export interface OmaBridgeSocket {
  readyState: number;
  on(event: string, handler: (...args: any[]) => void): this;
  send(payload: string): void;
  close(code?: number, reason?: string): void;
}

export interface OmaBridgeHost {
  start(params: SessionStartParams): Promise<SessionStartResult>;
  prompt(params: SessionPromptParams): Promise<void>;
  cancel(sessionId: string, turnId: string): void;
  dispose(sessionId: string): Promise<void>;
  announceAll(): void;
}

interface OmaBridgeDeps {
  credentials: OmaBridgeCredentials;
  host: OmaBridgeHost;
  detectAgents: () => Promise<Array<{ id: string; binary: string }>>;
  socketFactory?: (url: string, token: string) => OmaBridgeSocket;
  version?: string;
}

/**
 * Connect Backchat's existing SessionManager directly to the OMA runtime
 * relay. Backchat stays the only local session daemon: local renderer turns
 * and cloud turns enter the same host and therefore share ACP children,
 * persistence, permission brokers, and cancellation behavior.
 */
export class OmaBridgeClient {
  #credentials: OmaBridgeCredentials;
  #host: OmaBridgeHost;
  #detectAgents: OmaBridgeDeps["detectAgents"];
  #socketFactory: NonNullable<OmaBridgeDeps["socketFactory"]>;
  #version: string;
  #socket: OmaBridgeSocket | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #reconnect: ReturnType<typeof setTimeout> | null = null;
  #backoffMs = 1_000;
  #stopped = false;
  #sessions = new Map<string, { tenantId: string; lifecycle: SessionLifecycle }>();

  constructor(deps: OmaBridgeDeps) {
    this.#credentials = deps.credentials;
    this.#host = deps.host;
    this.#detectAgents = deps.detectAgents;
    this.#version = deps.version ?? "backchat";
    this.#socketFactory = deps.socketFactory ?? ((url, token) => new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}` },
      followRedirects: true,
    }) as OmaBridgeSocket);
  }

  async connect(): Promise<void> {
    this.#stopped = false;
    await this.#attach();
  }

  async #attach(): Promise<void> {
    if (this.#stopped) return;
    const socket = this.#socketFactory(
      omaBridgeWebSocketUrl(this.#credentials.serverUrl),
      this.#credentials.token,
    );
    this.#socket = socket;

    socket.on("open", () => {
      void this.#onOpen(socket);
    });
    socket.on("message", (data: { toString(): string } | string) => {
      this.#onMessage(typeof data === "string" ? data : data.toString());
    });
    socket.on("error", (error: Error) => {
      process.stderr.write(`[oma-bridge] socket error: ${error.message}\n`);
    });
    socket.on("close", () => {
      if (this.#heartbeat) clearInterval(this.#heartbeat);
      this.#heartbeat = null;
      if (this.#socket === socket) this.#socket = null;
      this.#scheduleReconnect();
    });
  }

  async #onOpen(socket: OmaBridgeSocket): Promise<void> {
    this.#backoffMs = 1_000;
    const agents = await this.#detectAgents();
    if (socket.readyState !== OPEN) return;
    socket.send(JSON.stringify({
      type: "hello",
      machine_id: this.#credentials.machineId,
      hostname: hostname(),
      os: `${platform()}/${process.arch}`,
      version: this.#version,
      agents,
      local_skills: {},
    }));
    this.#host.announceAll();
    this.#heartbeat = setInterval(() => {
      if (socket.readyState === OPEN) {
        socket.send(JSON.stringify({ type: "ping" }));
      }
    }, HEARTBEAT_MS);
    process.stderr.write(`[oma-bridge] Backchat attached to ${this.#credentials.serverUrl}\n`);
  }

  #onMessage(raw: string): void {
    let message: SessionWireMessage;
    try {
      message = JSON.parse(raw) as SessionWireMessage;
    } catch {
      return;
    }
    if (message.type === "welcome" || message.type === "pong") return;
    const command = decodeSessionCommand(message);
    if (!command) return;
    switch (command.type) {
      case "session.start":
        this.#sessions.set(command.sessionId, {
          tenantId: typeof message.tenant_id === "string" ? message.tenant_id : "",
          lifecycle: reduceSessionLifecycle(
            initialSessionLifecycle(command.sessionId),
            { type: "start.requested" },
          ),
        });
        void this.#host.start({
          session_id: command.sessionId,
          agent_id: command.agentId,
          workspace_mode: "managed",
          ...(command.acpSessionId ? { resume: { acp_session_id: command.acpSessionId } } : {}),
        });
        return;
      case "session.prompt":
        this.#advanceLifecycle(command.sessionId, {
          type: "prompt.requested",
          turnId: command.turnId,
        });
        void this.#host.prompt({
          session_id: command.sessionId,
          turn_id: command.turnId,
          text: command.text,
        });
        return;
      case "session.cancel":
        this.#host.cancel(command.sessionId, command.turnId);
        return;
      case "session.dispose":
        void this.#host.dispose(command.sessionId);
        return;
    }
  }

  /** Tee Backchat SessionManager output into the OMA relay. Local-only
   * sessions are ignored; bridge-owned ids are pinned on session.start. */
  handleSessionEvent(message: SessionEventOut): void {
    const session = this.#sessions.get(message.session_id);
    const tenantId = session?.tenantId;
    const socket = this.#socket;
    if (tenantId === undefined || !socket || socket.readyState !== OPEN) return;

    let outbound: Record<string, unknown> | null = null;
    let lifecycleEvent:
      | Parameters<typeof reduceSessionLifecycle>[1]
      | undefined;
    switch (message.type) {
      case "session.ready":
        lifecycleEvent = {
          type: "session.ready",
          acpSessionId: message.acp_session_id,
        };
        outbound = encodeSessionHostEvent({
          type: "session.ready",
          sessionId: message.session_id,
          acpSessionId: message.acp_session_id,
        }, { tenantId });
        break;
      case "session.event":
        outbound = {
          type: "session.event",
          session_id: message.session_id,
          tenant_id: tenantId,
          turn_id: message.turn_id,
          event: message.event,
        };
        break;
      case "session.complete":
        lifecycleEvent = { type: "session.complete", turnId: message.turn_id };
        outbound = encodeSessionHostEvent({
          type: "session.complete",
          sessionId: message.session_id,
          turnId: message.turn_id,
        }, { tenantId });
        break;
      case "session.error":
        lifecycleEvent = {
          type: "session.error",
          ...(message.turn_id ? { turnId: message.turn_id } : {}),
          message: message.message,
        };
        outbound = encodeSessionHostEvent({
          type: "session.error",
          sessionId: message.session_id,
          ...(message.turn_id ? { turnId: message.turn_id } : {}),
          message: message.message,
        }, { tenantId });
        break;
      case "session.disposed":
        lifecycleEvent = { type: "session.disposed" };
        outbound = encodeSessionHostEvent({
          type: "session.disposed",
          sessionId: message.session_id,
        }, { tenantId });
        break;
      case "session.native_subagent":
      case "session.queue_update":
        break;
    }
    if (lifecycleEvent) {
      const next = reduceSessionLifecycle(session!.lifecycle, lifecycleEvent);
      if (next === session!.lifecycle) return;
      session!.lifecycle = next;
      if (message.type === "session.disposed") this.#sessions.delete(message.session_id);
    }
    if (outbound) socket.send(JSON.stringify(outbound));
  }

  #advanceLifecycle(
    sessionId: string,
    event: Parameters<typeof reduceSessionLifecycle>[1],
  ): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    session.lifecycle = reduceSessionLifecycle(session.lifecycle, event);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    if (this.#reconnect) clearTimeout(this.#reconnect);
    this.#heartbeat = null;
    this.#reconnect = null;
    this.#socket?.close(1000, "Backchat shutdown");
    this.#socket = null;
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnect) return;
    const delay = this.#backoffMs;
    this.#backoffMs = Math.min(this.#backoffMs * 2, RECONNECT_MAX_MS);
    this.#reconnect = setTimeout(() => {
      this.#reconnect = null;
      void this.#attach();
    }, delay);
  }
}

/** Read credentials written by `oma bridge setup`. A missing file simply
 * means Backchat runs local-only; setup remains owned by the CLI. */
export async function readOmaBridgeCredentials(
  profile = (process.env.OMA_PROFILE ?? "").trim(),
): Promise<OmaBridgeCredentials | null> {
  if (profile && !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(profile)) {
    process.stderr.write(`[oma-bridge] ignoring invalid OMA_PROFILE=${JSON.stringify(profile)}\n`);
    return null;
  }
  const suffix = profile ? `-${profile}` : "";
  const file = join(homedir(), `.oma/bridge${suffix}`, "credentials.json");
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as Partial<OmaBridgeCredentials>;
    if (
      typeof value.serverUrl !== "string"
      || typeof value.token !== "string"
      || typeof value.machineId !== "string"
      || !value.serverUrl
      || !value.token
      || !value.machineId
    ) return null;
    return {
      serverUrl: value.serverUrl,
      token: value.token,
      machineId: value.machineId,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    process.stderr.write(`[oma-bridge] credentials unreadable: ${String(error)}\n`);
    return null;
  }
}
