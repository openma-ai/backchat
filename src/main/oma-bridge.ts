import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir, hostname, platform } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { DaemonConnection, type DaemonChannel } from "@openma/common/local-runtime";
import type { DeliveredRunnerOutput, OpenmaRunnerOutbox, RunnerOutput } from "./openma-runner-outbox.js";
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
  runtimeId?: string;
  tenants?: Array<{ id: string; name: string; agentApiKey: string }>;
}

export type OmaBridgeConnectionState = "connecting" | "online" | "offline" | "occupied" | "expired" | "stopped";

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
  outbox?: OpenmaRunnerOutbox;
  onConnectionState?: (state: OmaBridgeConnectionState) => void;
  resolveWorkspace?: (sessionId: string, tenantId: string, agentId: string) => Promise<{
    localSessionId: string; projectId: string; cwd: string; additionalDirectories: string[];
  }>;
}

interface BridgeSession {
  key: string; sessionId: string; localSessionId?: string; tenantId: string; agentId: string;
  acpSessionId?: string;
  lifecycle: SessionLifecycle; start: Promise<boolean>;
}
type PermissionResult = { outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } };
interface BridgePermission {
  id: string; session: BridgeSession; turnId: string; params: unknown;
  options: Set<string>; resolve: (result: PermissionResult) => void;
  output?: DeliveredRunnerOutput;
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
  #connection: DaemonConnection;
  #stopped = false;
  #onConnectionState?: OmaBridgeDeps["onConnectionState"];
  #resolveWorkspace: OmaBridgeDeps["resolveWorkspace"];
  #sessions = new Map<string, BridgeSession>();
  #localSessions = new Map<string, BridgeSession>();
  #permissions = new Map<string, BridgePermission>();
  #answeredPermissions = new Map<string, { session: BridgeSession; turnId: string }>();
  #outbox?: OpenmaRunnerOutbox;
  #deliveryMode: "durable" | "legacy" | null = null;

  constructor(deps: OmaBridgeDeps) {
    this.#credentials = deps.credentials;
    this.#host = deps.host;
    this.#detectAgents = deps.detectAgents;
    this.#version = deps.version ?? "backchat";
    this.#onConnectionState = deps.onConnectionState;
    this.#resolveWorkspace = deps.resolveWorkspace;
    this.#outbox = deps.outbox;
    this.#socketFactory = deps.socketFactory ?? ((url, token) => new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}` },
      followRedirects: true,
    }) as OmaBridgeSocket);
    this.#connection = new DaemonConnection({
      openSocket: () => {
        this.#deliveryMode = null;
        return this.#socketFactory(omaBridgeWebSocketUrl(this.#credentials.serverUrl), this.#credentials.token);
      },
      onOpen: (channel) => this.#onOpen(channel),
      onMessage: (message) => this.#onMessage(message as SessionWireMessage & { capabilities?: unknown }),
      onState: (state) => {
        if (state === "occupied" || state === "expired" || state === "stopped") {
          this.#stopped = true;
          for (const session of this.#localSessions.values()) this.cancelPendingFor(session.localSessionId!);
        }
        this.#onConnectionState?.(state);
      },
    });
  }

  async connect(): Promise<void> {
    this.#stopped = false;
    this.#connection.start();
  }

  async #onOpen(channel: DaemonChannel): Promise<void> {
    const agents = await this.#detectAgents();
    if (!channel.send({
      type: "hello",
      machine_id: this.#credentials.machineId,
      hostname: hostname(),
      os: `${platform()}/${process.arch}`,
      version: this.#version,
      agents,
      local_skills: {},
      ...(this.#outbox ? { capabilities: ["durable_session_events_v1"] } : {}),
    })) return;
    if (!this.#outbox) {
      this.#host.announceAll();
      for (const pending of this.#permissions.values()) this.#sendPermission(pending);
    }
  }

  #onMessage(message: SessionWireMessage & { capabilities?: unknown }): void {
    if (message.type === "welcome") {
      if (this.#outbox && this.#deliveryMode === null) {
        this.#deliveryMode = Array.isArray(message.capabilities) && message.capabilities.includes("durable_session_events_v1") ? "durable" : "legacy";
        for (const output of this.#outbox.pending()) this.#transmit(output);
        this.#host.announceAll();
        for (const pending of this.#permissions.values()) this.#sendPermission(pending);
      }
      return;
    }
    if (message.type === "session.ack") {
      if (this.#deliveryMode === "durable") this.#outbox?.acknowledge(message);
      return;
    }
    if (message.type === "pong") return;
    if (message.type === "session.response") { this.#respondPermission(message); return; }
    const command = decodeSessionCommand(message);
    if (!command) return;
    const tenantId = typeof message.tenant_id === "string" ? message.tenant_id : "";
    const key = JSON.stringify([tenantId, command.sessionId]);
    const owner = this.#sessions.get(key);
    if (this.#credentials.tenants && (
      !this.#credentials.tenants.some((tenant) => tenant.id === tenantId)
      || (command.type !== "session.start" && !owner)
    ) || (owner && owner.tenantId !== tenantId)) {
      this.#connection.send({ type: "session.error", session_id: command.sessionId, tenant_id: tenantId, message: "Session workspace is not authorized for this runner" });
      return;
    }
    switch (command.type) {
      case "session.start":
        if (owner && owner.agentId !== command.agentId) {
          this.#sendError(command.sessionId, tenantId, "A task's execution agent cannot change");
          return;
        }
        if (owner) {
          // The shared host announces its existing session on reconnect. Do not
          // resolve a different directory or reset an in-flight lifecycle.
          void owner.start.then((ready) => {
            if (ready && !this.#stopped) {
              this.#host.announceAll();
              for (const pending of this.#permissions.values()) if (pending.session === owner) this.#sendPermission(pending);
            }
          });
          return;
        }
        this.#sessions.set(key, {
          key, sessionId: command.sessionId, tenantId, agentId: command.agentId,
          lifecycle: reduceSessionLifecycle(initialSessionLifecycle(command.sessionId), { type: "start.requested" }),
          start: this.#start(command, tenantId, key),
        });
        return;
      case "session.prompt":
        if (!owner) return;
        void owner.start.then(async (ready) => {
          if (!ready || this.#stopped) return;
          this.#advanceLifecycle(key, { type: "prompt.requested", turnId: command.turnId });
          await this.#host.prompt({ session_id: owner.localSessionId!, turn_id: command.turnId, text: command.text });
        }).catch((error: Error) => this.#sendError(command.sessionId, tenantId, error.message, command.turnId));
        return;
      case "session.cancel":
        if (owner) void owner.start.then((ready) => {
          if (ready && !this.#stopped) this.#host.cancel(owner.localSessionId!, command.turnId);
        }).catch((error: Error) => this.#sendError(command.sessionId, tenantId, error.message, command.turnId));
        return;
      case "session.dispose":
        if (owner) void owner.start.then(async (ready) => {
          if (ready && !this.#stopped) await this.#host.dispose(owner.localSessionId!);
        }).catch((error: Error) => this.#sendError(command.sessionId, tenantId, error.message));
        return;
    }
  }

  async #start(command: { sessionId: string; agentId: string; acpSessionId?: string }, tenantId: string, key: string): Promise<boolean> {
    // Yield before failure handling so the ownership record exists even if
    // resolution fails synchronously. No unhandled rejection reaches main.
    await Promise.resolve();
    try {
      if (!this.#resolveWorkspace) throw new Error("This environment has no linked project on this runner");
      const workspace = await this.#resolveWorkspace(command.sessionId, tenantId, command.agentId);
      if (this.#stopped) return false;
      const owner = this.#sessions.get(key)!;
      if (!workspace.localSessionId || workspace.localSessionId === command.sessionId || this.#localSessions.has(workspace.localSessionId)) {
        throw new Error("Runner task needs a distinct scoped execution session");
      }
      owner.localSessionId = workspace.localSessionId;
      this.#localSessions.set(workspace.localSessionId, owner);
      const result = await this.#host.start({
        session_id: workspace.localSessionId, agent_id: command.agentId,
        workspace_mode: "project", project_id: workspace.projectId,
        cwd: workspace.cwd, additional_directories: workspace.additionalDirectories,
        ...(command.acpSessionId ? { resume: { acp_session_id: command.acpSessionId } } : {}),
      });
      if (result.status !== "ready") {
        this.#sendError(command.sessionId, tenantId, "Runner could not start the linked project session");
        this.#forget(key);
        return false;
      }
      return true;
    } catch (error) {
      this.#sendError(command.sessionId, tenantId, error instanceof Error ? error.message : "Could not resolve the task project");
      this.#forget(key);
      return false;
    }
  }

  #sendError(sessionId: string, tenantId: string, message: string, turnId?: string): void {
    this.#sendOutput({
      type: "session.error", session_id: sessionId, tenant_id: tenantId, message,
      ...(turnId ? { turn_id: turnId } : {}),
    });
  }

  #sendOutput(output: RunnerOutput): DeliveredRunnerOutput | undefined {
    if (this.#stopped) return;
    const saved = this.#outbox?.append(output);
    this.#transmit(saved ?? output);
    return saved;
  }

  #transmit(output: RunnerOutput): void {
    if (this.#stopped || (this.#outbox && this.#deliveryMode === null)) return;
    if (this.#credentials.tenants && !this.#credentials.tenants.some((tenant) => tenant.id === output.tenant_id)) return;
    // Existing v1 services have no receipt protocol; retain their best-effort
    // live behavior. A failed send leaves durable frames replayable.
    const { delivery, ...legacy } = output;
    const sent = this.#connection.send(this.#deliveryMode === "legacy" ? legacy : output);
    if (sent && this.#deliveryMode === "legacy" && delivery) this.#outbox?.acknowledge(output, true);
  }

  /** Tee Backchat SessionManager output into the OMA relay. Local-only
   * sessions are ignored; bridge-owned ids are pinned on session.start. */
  handleSessionEvent(message: SessionEventOut): void {
    const session = this.#localSessions.get(message.session_id);
    const tenantId = session?.tenantId;
    if (this.#stopped || tenantId === undefined) return;

    let outbound: Record<string, unknown> | null = null;
    let terminal: Record<string, unknown> | null = null;
    let lifecycleEvent:
      | Parameters<typeof reduceSessionLifecycle>[1]
      | undefined;
    switch (message.type) {
      case "session.ready":
        session!.acpSessionId = message.acp_session_id;
        lifecycleEvent = {
          type: "session.ready",
          acpSessionId: message.acp_session_id,
        };
        outbound = encodeSessionHostEvent({
          type: "session.ready",
          sessionId: session!.sessionId,
          acpSessionId: message.acp_session_id,
        }, { tenantId });
        break;
      case "session.event":
        outbound = {
          type: "session.event",
          session_id: session!.sessionId,
          tenant_id: tenantId,
          turn_id: message.turn_id,
          // Backchat stores the update itself; the service translator consumes
          // ACP's notification envelope. Already wrapped or terminal records
          // pass through unchanged.
          event: message.event && typeof message.event === "object" && "sessionUpdate" in message.event
            ? { sessionId: session!.acpSessionId, update: message.event }
            : message.event,
        };
        break;
      case "session.cancelled":
      case "session.complete":
        // I1: only an actual PromptResponse settles a cancelled remote turn.
        if (message.type === "session.cancelled" && !message.stop_reason) return;
        lifecycleEvent = { type: "session.complete", turnId: message.turn_id };
        if (message.stop_reason) terminal = {
          type: "session.event", session_id: session!.sessionId, tenant_id: tenantId, turn_id: message.turn_id,
          event: { type: "promptComplete", response: {
            stopReason: message.stop_reason,
            ...(message.usage ? { usage: message.usage } : {}),
            ...(message.meta ? { _meta: message.meta } : {}),
          } },
        };
        outbound = encodeSessionHostEvent({
          type: "session.complete",
          sessionId: session!.sessionId,
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
          sessionId: session!.sessionId,
          ...(message.turn_id ? { turnId: message.turn_id } : {}),
          message: message.message,
        }, { tenantId });
        break;
      case "session.disposed":
        lifecycleEvent = { type: "session.disposed" };
        outbound = encodeSessionHostEvent({
          type: "session.disposed",
          sessionId: session!.sessionId,
        }, { tenantId });
        break;
      case "session.native_subagent":
      case "session.queue_update":
        break;
    }
    if (lifecycleEvent) {
      // I1: a reconnect announcement is not a PromptResponse. Preserve the
      // active turn until the host reports that original prompt's stop reason.
      const next = lifecycleEvent.type === "session.ready" && session!.lifecycle.activeTurnId
        ? { ...session!.lifecycle, acpSessionId: lifecycleEvent.acpSessionId }
        : reduceSessionLifecycle(session!.lifecycle, lifecycleEvent);
      if (next === session!.lifecycle) return;
      session!.lifecycle = next;
      if (message.type === "session.disposed") this.#forget(session!.key);
    }
    if (terminal) this.#sendOutput(terminal as RunnerOutput);
    if (outbound) this.#sendOutput(outbound as RunnerOutput);
  }

  #advanceLifecycle(
    sessionId: string,
    event: Parameters<typeof reduceSessionLifecycle>[1],
  ): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    session.lifecycle = reduceSessionLifecycle(session.lifecycle, event);
  }

  #forget(key: string): void {
    const session = this.#sessions.get(key);
    if (session?.localSessionId) this.cancelPendingFor(session.localSessionId);
    if (session?.localSessionId) this.#localSessions.delete(session.localSessionId);
    for (const [id, answered] of this.#answeredPermissions) if (answered.session === session) this.#answeredPermissions.delete(id);
    this.#sessions.delete(key);
  }

  stop(): void {
    this.#stopped = true;
    for (const session of this.#localSessions.values()) this.cancelPendingFor(session.localSessionId!);
    this.#connection.stop();
  }

  requestPermission(localSessionId: string, params: unknown): Promise<PermissionResult> {
    const session = this.#localSessions.get(localSessionId);
    const turnId = session?.lifecycle.activeTurnId;
    const options = (params as { options?: Array<{ optionId?: string }> } | null)?.options;
    if (this.#stopped || !session || !turnId || !Array.isArray(options) || !options.length || options.some((option) => typeof option.optionId !== "string")) {
      return Promise.resolve({ outcome: { outcome: "cancelled" } });
    }
    return new Promise((resolve) => {
      const pending: BridgePermission = { id: `runner-action-${randomUUID()}`, session, turnId, params, options: new Set(options.map((option) => option.optionId!)), resolve };
      this.#permissions.set(pending.id, pending);
      this.#sendPermission(pending);
    });
  }

  #sendPermission(pending: BridgePermission): void {
    if (pending.output) this.#transmit(pending.output);
    else pending.output = this.#sendOutput({ type: "session.event", session_id: pending.session.sessionId, tenant_id: pending.session.tenantId, turn_id: pending.turnId,
      event: { type: "client.request", request_id: pending.id, method: "session/request_permission", params: pending.params },
    });
    if (this.#deliveryMode === "legacy") pending.output = undefined;
  }

  #respondPermission(message: SessionWireMessage & { request_id?: unknown; response?: unknown }): void {
    if (typeof message.request_id !== "string" || typeof message.session_id !== "string" || typeof message.tenant_id !== "string" || typeof message.turn_id !== "string") return;
    const pending = this.#permissions.get(message.request_id);
    const acknowledged = pending ?? this.#answeredPermissions.get(message.request_id);
    if (!acknowledged || acknowledged.session.sessionId !== message.session_id || acknowledged.session.tenantId !== message.tenant_id || acknowledged.turnId !== message.turn_id) return;
    if (pending) {
      const result = message.response as PermissionResult | undefined;
      if (result?.outcome?.outcome !== "cancelled" && !(result?.outcome?.outcome === "selected" && pending.options.has(result.outcome.optionId))) return;
      this.#permissions.delete(pending.id);
      this.#answeredPermissions.set(pending.id, { session: pending.session, turnId: pending.turnId });
      pending.resolve(result);
    }
    this.#sendOutput({ type: "session.event", session_id: message.session_id, tenant_id: message.tenant_id, turn_id: message.turn_id,
      event: { type: "client.response", request_id: message.request_id },
    });
  }

  cancelPendingFor(localSessionId: string): void {
    for (const [id, pending] of this.#permissions) if (pending.session.localSessionId === localSessionId) {
      this.#permissions.delete(id);
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
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
      ...(typeof value.runtimeId === "string" ? { runtimeId: value.runtimeId } : {}),
      ...(Array.isArray(value.tenants) ? { tenants: value.tenants.filter((t) => typeof t.id === "string" && typeof t.agentApiKey === "string" && !!t.agentApiKey) } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    process.stderr.write(`[oma-bridge] credentials unreadable: ${String(error)}\n`);
    return null;
  }
}
