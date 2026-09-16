import { sessionInputIdentityPrefix } from "@openma/common/managed-runtime";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { OpenmaAccount, OpenmaConnection } from "./openma-account.js";
import type { OpenmaCatalog, OpenmaExecutionTarget, OpenmaScope, OpenmaTask, OpenmaTaskEvent, OpenmaTaskSnapshot } from "../shared/openma.js";
import { OpenmaTaskStore } from "./openma-task-store.js";
import { OpenManagedCloudRuntimeClient } from "./openmanaged-cloud-runtime.js";
import { openmaPendingActions } from "../shared/openma-actions.js";
import type { OpenmaTaskResponse, OpenmaTaskUpdate } from "../shared/openma.js";
import { OpenmaTaskFiles } from "./openma-task-files.js";
import { openmaDesktopTaskId } from "./openma-identity.js";
export { openmaDesktopTaskId } from "./openma-identity.js";
interface Options { directory: string; account: OpenmaAccount; catalog: (scope: OpenmaScope) => Promise<OpenmaCatalog>; fetchImpl?: typeof fetch; onSnapshot?: (snapshot: OpenmaTaskSnapshot) => void; onTaskUpdated?: (task: OpenmaTask) => void; reconnectMs?: number }
interface Observer { owners: Set<string>; controller: AbortController; connection: OpenmaTaskSnapshot["connection"]; transient: OpenmaTaskEvent[]; error?: string; credentials: OpenmaConnection; publishTimer?: ReturnType<typeof setTimeout> }

function timestamp(value: unknown, fallback: number): number {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : fallback;
}

export class OpenmaTasks {
  #store: OpenmaTaskStore;
  #observers = new Map<string, Observer>();
  #unsubscribe: () => void;
  #closed = false;
  #updates = new Map<string, Promise<unknown>>();
  constructor(private options: Options) {
    this.#store = new OpenmaTaskStore(join(options.directory, "tasks.db"));
    this.#unsubscribe = options.account.subscribe(() => {
      for (const [id, observer] of this.#observers) {
        try { options.account.assertConnection(observer.credentials); }
        catch { this.#stopObserver(id); }
      }
    });
  }
  #check(connection: OpenmaConnection) {
    if (this.#closed) throw new Error("OpenMA client is closed");
    this.options.account.assertConnection(connection);
  }
  #client(connection: OpenmaConnection) {
    return new OpenManagedCloudRuntimeClient({ ...connection, fetchImpl: this.options.fetchImpl, onUnauthorized: () => this.options.account.invalidate(connection) });
  }
  #task(id: string): OpenmaTask {
    if (this.#closed) throw new Error("OpenMA client is closed");
    const task = this.#store.get(id);
    if (!task) throw new Error("Unknown OpenMA task");
    this.options.account.connection(task);
    return task;
  }
  list(scope?: OpenmaScope): OpenmaTask[] {
    if (this.#closed) throw new Error("OpenMA client is closed");
    return (scope ? [this.options.account.connection(scope)] : this.options.account.connections()).flatMap((connection) => this.#store.list(connection));
  }
  search(query: string, limit = 12) {
    if (this.#closed) throw new Error("OpenMA client is closed");
    if (typeof query !== "string" || query.length > 500 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid task search");
    return this.options.account.connections().flatMap((connection) => this.#store.search(connection, query, limit)).sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
  async update(id: string, patch: OpenmaTaskUpdate): Promise<OpenmaTask> {
    this.#task(id);
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || !Object.keys(patch).length
      || Object.keys(patch).some((key) => !["title", "pinned", "archived"].includes(key))
      || patch.title !== undefined && (typeof patch.title !== "string" || !patch.title.trim() || patch.title.length > 500)
      || patch.pinned !== undefined && typeof patch.pinned !== "boolean"
      || patch.archived !== undefined && typeof patch.archived !== "boolean") throw new Error("Invalid OpenMA task update");
    const operation = (this.#updates.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const task = this.#task(id);
      const connection = this.options.account.connection(task);
      const client = this.#client(connection);
      if (patch.title !== undefined) {
        const session = await client.request(() => client.sdk.beta.sessions.update(task.sessionId, { title: patch.title!.trim() }));
        this.#check(connection);
        const current = this.#store.get(id)!;
        this.#store.save({ ...current, title: session.title ?? patch.title.trim(), status: current.revision === task.revision ? session.status : current.status,
          updatedAt: timestamp(session.updated_at, Date.now()),
        });
      }
      // This check also prevents a result from an old workspace reaching the UI.
      this.#task(id);
      if (patch.pinned !== undefined || patch.archived !== undefined) this.#store.setPreferences(id, patch);
      const updated = this.#task(id);
      this.options.onTaskUpdated?.(updated);
      this.#publish(id);
      return updated;
    });
    this.#updates.set(id, operation);
    try { return await operation; }
    finally { if (this.#updates.get(id) === operation) this.#updates.delete(id); }
  }
  async files(id: string) {
    const task = this.#task(id);
    const connection = this.options.account.connection(task);
    const files = await new OpenmaTaskFiles(this.#client(connection), task.sessionId).list();
    this.#check(connection); return files;
  }
  async previewFile(id: string, fileId: string) {
    const task = this.#task(id);
    const connection = this.options.account.connection(task);
    const preview = await new OpenmaTaskFiles(this.#client(connection), task.sessionId).preview(fileId);
    this.#check(connection); return preview;
  }
  async readFile(id: string, fileId: string) {
    const task = this.#task(id);
    const connection = this.options.account.connection(task);
    const file = await new OpenmaTaskFiles(this.#client(connection), task.sessionId).read(fileId);
    this.#check(connection); return file;
  }

  async refresh(requestedScope?: OpenmaScope): Promise<OpenmaTask[]> {
    if (!requestedScope) {
      const results = await Promise.allSettled(this.options.account.connections().map((connection) => this.refresh(connection)));
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      return this.list();
    }
    const connection = this.options.account.connection(requestedScope);
    const revisions = new Map(this.list(connection).map((task) => [task.id, task.revision ?? 0]));
    const client = this.#client(connection);
    const catalog = await this.options.catalog(connection);
    const scope = { baseUrl: connection.baseUrl, userId: connection.userId, workspaceId: connection.workspaceId };
    await client.request(async () => {
      for await (const session of client.sdk.beta.sessions.list()) {
        this.#check(connection);
        if (!session.id || !session.agent?.id || !session.environment_id) continue;
        const id = openmaDesktopTaskId(scope, session.id);
        const previous = this.#store.get(id);
        if (previous && (previous.revision ?? 0) > (revisions.get(id) ?? 0)) continue;
        const environment = catalog.environments.find((env) => env.id === session.environment_id);
        const runtimeId = session.metadata?.["backchat.runtime_id"] || environment?.runtimeId || null;
        const runner = catalog.runners.find((runtime) => runtime.id === runtimeId);
        const kind = runtimeId || environment?.type === "self_hosted" || session.metadata?.["backchat.runtime_kind"] === "runner" ? "runner" : "cloud";
        this.#store.save({ ...scope, id, sessionId: session.id, title: session.title ?? session.id, status: session.status,
          createdAt: timestamp(session.created_at, previous?.createdAt ?? Date.now()), updatedAt: timestamp(session.updated_at, previous?.updatedAt ?? Date.now()), afterSeq: previous?.afterSeq ?? 0,
          // A mutable environment or agent catalogue cannot move an existing task.
          target: previous?.target ?? { ...scope, kind, agentId: session.agent.id, agentName: session.agent.name, environmentId: session.environment_id, environmentName: environment?.name ?? session.environment_id, runtimeId, runtimeName: runner?.name ?? (kind === "runner" ? "Runner" : "Cloud") },
        });
      }
    });
    this.#check(connection);
    return this.list(connection);
  }

  async create(target: OpenmaExecutionTarget, title: string): Promise<OpenmaTaskSnapshot> {
    const connection = this.options.account.connection(target);
    const catalog = await this.options.catalog(connection);
    const env = catalog.environments.find((env) => env.id === target.environmentId);
    if (!env) throw new Error("The selected environment is no longer available");
    let agentName: string;
    let runtimeName = "Cloud";
    if (target.kind === "cloud") {
      const agent = catalog.cloudAgents.find((agent) => agent.id === target.agentId);
      if (env.type !== "cloud" || target.runtimeId !== null || !agent) throw new Error("Choose an available cloud agent and environment");
      agentName = agent.name;
    } else {
      const runner = catalog.runners.find((runner) => runner.id === target.runtimeId);
      const agent = runner?.agents.flatMap((agent) => agent.bindings).find((agent) => agent.id === target.agentId);
      if (!runner || runner.status !== "online" || !agent || env.runtimeId !== runner.id || env.type !== "self_hosted") throw new Error("The selected runner or project environment is unavailable");
      agentName = agent.name; runtimeName = runner.name;
    }
    this.#check(connection);
    const client = this.#client(connection);
    const session = await client.request(() => client.sdk.beta.sessions.create({
      agent: target.agentId, environment_id: env.id, title,
      metadata: { "backchat.runtime_kind": target.kind, "backchat.runtime_id": target.runtimeId ?? "", "backchat.creation_id": randomUUID() },
    }));
    if (!session.id) throw new Error("OpenMA did not return a session ID");
    const scope = { baseUrl: connection.baseUrl, userId: connection.userId, workspaceId: connection.workspaceId };
    const task: OpenmaTask = { ...scope, id: openmaDesktopTaskId(scope, session.id), sessionId: session.id,
      target: { ...scope, kind: target.kind, agentId: target.agentId, agentName, environmentId: env.id, environmentName: env.name, runtimeId: target.runtimeId, runtimeName },
      title, status: session.status, afterSeq: 0, createdAt: timestamp(session.created_at, Date.now()), updatedAt: timestamp(session.updated_at, Date.now()),
    };
    if (this.#closed) throw new Error("OpenMA client closed after task creation");
    this.#check(connection);
    this.#store.save(task);
    // Creation does not own a view. The mounted task page acquires its own
    // subscription, which can be released without retaining a hidden observer.
    return this.snapshot(task.id);
  }

  open(id: string, owner = "default"): OpenmaTaskSnapshot {
    const task = this.#task(id);
    if (!this.#observers.has(id)) {
      const observer: Observer = { owners: new Set([owner]), controller: new AbortController(), connection: "connecting", transient: [], credentials: this.options.account.connection(task) };
      this.#observers.set(id, observer);
      void this.#observe(id, observer);
    } else this.#observers.get(id)!.owners.add(owner);
    return this.snapshot(id);
  }
  snapshot(id: string): OpenmaTaskSnapshot {
    const task = this.#task(id);
    const observer = this.#observers.get(id);
    return { task, events: [...this.#store.events(id), ...(observer?.transient ?? [])], operations: this.#store.operations(id), connection: observer?.connection ?? "offline", ...(observer?.error ? { error: observer.error } : {}) };
  }
  #publish(id: string) {
    const observer = this.#observers.get(id);
    if (!observer || observer.publishTimer || this.#closed) return;
    observer.publishTimer = setTimeout(() => {
      observer.publishTimer = undefined;
      if (observer.controller.signal.aborted || this.#closed) return;
      try { this.options.onSnapshot?.(this.snapshot(id)); } catch { /* Account changed while the event was queued. */ }
    }, 30);
  }
  #ingest(id: string, observer: Observer, event: OpenmaTaskEvent) {
    if (event.type.startsWith("system.user_message_")) {
      // Promotion frames carry the future durable seq but are not the event
      // itself. Checkpointing one could skip the user message on reconnect.
      observer.transient = observer.transient.filter((e) => e.event_id !== event.event_id);
      if (event.type === "system.user_message_pending") observer.transient.push(event);
    } else if (event.type.includes("_chunk") || event.type.includes("_stream_")) {
      const key = event.message_id ?? event.thinking_id ?? event.tool_use_id;
      if (event.type.endsWith("_stream_start")) observer.transient = observer.transient.filter((e) => (e.message_id ?? e.thinking_id ?? e.tool_use_id) !== key);
      const prior = observer.transient.find((e) => e.type === event.type && (e.message_id ?? e.thinking_id ?? e.tool_use_id) === key);
      if (prior && typeof event.delta === "string") prior.delta = String(prior.delta ?? "") + event.delta;
      else observer.transient.push({ ...event });
    } else {
      const cursor = this.#store.get(id)!.afterSeq;
      const added = this.#store.append(id, event);
      const key = event.message_id ?? event.thinking_id;
      if (key) observer.transient = observer.transient.filter((e) => (e.message_id ?? e.thinking_id) !== key);
      if (event.id) observer.transient = observer.transient.filter((e) => e.event_id !== event.id);
      const status = event.type === "session.status_running" ? "running" : event.type === "session.status_idle" ? "idle" : event.type === "session.status_terminated" ? "terminated" : event.type === "session.status_rescheduled" ? "rescheduling" : undefined;
      if (status && added && (typeof event.seq !== "number" || event.seq > cursor)) {
        const task = this.#store.get(id)!;
        this.#store.save({ ...task, status, updatedAt: timestamp(event.processed_at, Date.now()) });
      }
    }
    this.#publish(id);
  }
  async #observe(id: string, observer: Observer) {
    const signal = observer.controller.signal;
    let retryMs = this.options.reconnectMs ?? 1000;
    while (!signal.aborted) {
      try {
        const task = this.#task(id);
        const client = this.#client(this.options.account.connection(task));
        observer.connection = "connecting"; observer.transient = []; observer.error = undefined; this.#publish(id);
        for await (const event of client.history(task.sessionId, { afterSeq: task.afterSeq, signal })) {
          if (signal.aborted) return;
          this.#ingest(id, observer, event);
        }
        const revision = this.#store.get(id)?.revision;
        const session = await client.request(() => client.sdk.beta.sessions.retrieve(task.sessionId, {}, { signal }));
        if (signal.aborted) return;
        if (this.#store.get(id)?.revision === revision) this.#store.save({ ...this.#store.get(id)!, status: session.status, title: session.title ?? task.title, updatedAt: timestamp(session.updated_at, task.updatedAt) });
        observer.connection = "online"; this.#publish(id);
        for await (const event of client.stream(task.sessionId, { afterSeq: this.#store.get(id)!.afterSeq, signal })) {
          if (signal.aborted) return;
          this.#ingest(id, observer, event);
          retryMs = this.options.reconnectMs ?? 1000;
        }
        if (!signal.aborted) throw new Error("OpenMA connection interrupted. Reconnecting…");
      } catch (error) {
        if (signal.aborted || this.#closed) return;
        observer.connection = "offline";
        observer.error = error instanceof Error ? error.message : "OpenMA connection interrupted";
        this.#publish(id);
      }
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, retryMs);
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
      retryMs = Math.min(retryMs * 2, 30_000);
    }
  }

  async #send(id: string, operationId: string, event: OpenmaTaskEvent): Promise<void> {
    const task = this.#task(id);
    const expectedId = `${await sessionInputIdentityPrefix(task.workspaceId, task.sessionId, operationId)}0`;
    this.#task(id);
    const outgoing = { ...event, id: expectedId };
    if (!this.#store.beginOperation(id, operationId, outgoing)) return;
    this.#publish(id);
    try {
      await this.#client(this.options.account.connection(task)).sendEvent(task.sessionId, event, operationId);
      if (!this.#closed) this.#store.settleOperation(id, operationId, "accepted");
    } catch (error) {
      if (!this.#closed) this.#store.settleOperation(id, operationId, "uncertain");
      throw error;
    } finally { this.#publish(id); }
  }
  async send(id: string, operationId: string, text: string): Promise<void> {
    if (!text.trim()) throw new Error("Enter a message");
    if (!operationId) throw new Error("Message operation ID is required");
    await this.#send(id, operationId, { type: "user.message", content: [{ type: "text", text }] });
  }
  async interrupt(id: string): Promise<void> { await this.#send(id, randomUUID(), { type: "user.interrupt" }); }
  async respond(id: string, requestId: string, response: OpenmaTaskResponse): Promise<void> {
    const task = this.#task(id);
    const pending = openmaPendingActions(this.#store.events(id)).find((action) => action.id === requestId);
    if (!pending) throw new Error("This OpenMA request is no longer pending");
    if (response.type !== pending.type) throw new Error("Response does not match the pending request");
    const thread = pending.event.session_thread_id;
    const event: OpenmaTaskEvent = response.type === "confirmation"
      ? { type: "user.tool_confirmation", tool_use_id: requestId, result: response.result }
      : { type: "user.custom_tool_result", custom_tool_use_id: requestId, content: [{ type: "text", text: response.text }], is_error: !!response.isError };
    if (typeof thread === "string") event.session_thread_id = thread;
    await this.#send(task.id, `response:${requestId}`, event);
  }
  detach(id: string, owner = "default"): void {
    const observer = this.#observers.get(id);
    if (!observer) return;
    observer.owners.delete(owner);
    if (observer.owners.size === 0) this.#stopObserver(id);
  }
  releaseOwner(owner: string): void {
    for (const id of this.#observers.keys()) this.detach(id, owner);
  }
  #stopObserver(id: string): void {
    const observer = this.#observers.get(id);
    if (!observer) return;
    observer.controller.abort();
    if (observer.publishTimer) clearTimeout(observer.publishTimer);
    this.#observers.delete(id);
  }
  stop(): void { for (const id of this.#observers.keys()) this.#stopObserver(id); }
  close(): void {
    this.#closed = true; this.#unsubscribe(); this.stop(); this.#store.close();
  }
}
