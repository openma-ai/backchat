import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AgentSession, AgentSessionEvent, AgentSessionItem } from "openai/resources/beta/agents/agents";
import type { Turn as RemoteTurn } from "openai/resources/beta/agents/sessions/turns";
import { decodeManagedStreamEvent, type ManagedStreamEvent } from "@openma/common/protocol/managed";
import { createOpenMAEvent, createVendorEvent, type OpenMAEvent, type CanonicalEventType } from "@openma/common/session-events/openma";
import type { DirectAgentProvider, OpenmaCatalog, OpenmaTaskEvent } from "../shared/openma.js";
import type { CloudSessionCreateInput } from "./openmanaged-cloud-runtime.js";

export interface RemoteSession {
  id: string; agent: { id: string; name?: string }; environment_id: string; title: string;
  status: "idle" | "running" | "rescheduling" | "terminated"; created_at: string; updated_at: string;
  metadata?: Record<string, string> | null;
}
interface Options { provider: DirectAgentProvider; baseUrl: string; apiKey: string; fetchImpl?: typeof fetch; onUnauthorized?: () => void }
const text = (content: unknown): string => typeof content === "string" ? content : Array.isArray(content) ? content.map(b => b.text ?? "").join("") : "";
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** Provider transports terminate at the canonical OpenMA event boundary. */
export class DirectAgentRuntime {
  readonly claude: Anthropic;
  readonly openai: OpenAI;
  #turnId?: string;
  #streamIndex = 0;
  constructor(readonly options: Options) {
    this.claude = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseUrl, fetch: options.fetchImpl, maxRetries: 0, timeout: 30_000 });
    this.openai = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl, fetch: options.fetchImpl, maxRetries: 0, timeout: 30_000 });
  }
  async request<T>(fn: () => PromiseLike<T>): Promise<T> {
    try { return await fn(); } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const status = (error as { status?: number })?.status;
      if (status === 401) this.options.onUnauthorized?.();
      // SDK/server errors can contain headers or arbitrary third-party text.
      throw new Error(`Agent service request failed${status ? ` (${status})` : ""}. Check the connection settings.`);
    }
  }
  async catalog(): Promise<OpenmaCatalog> {
    const cloudAgents: OpenmaCatalog["cloudAgents"] = [];
    const environments: OpenmaCatalog["environments"] = [];
    await this.request(async () => {
      if (this.options.provider === "claude-managed") {
        for await (const a of this.claude.beta.agents.list()) cloudAgents.push({ id: a.id, name: a.name || a.id });
        for await (const e of this.claude.beta.environments.list()) if (!e.archived_at && e.config.type === "cloud") environments.push({ id: e.id, name: e.name || e.id, type: "cloud", runtimeId: null });
      } else {
        for await (const a of this.openai.beta.agents.list()) cloudAgents.push({ id: a.id, name: a.name || a.id });
        environments.push({ id: "none", name: "No sandbox", type: "cloud", runtimeId: null }, { id: "openai_hosted", name: "Hosted sandbox", type: "cloud", runtimeId: null });
      }
    });
    return { runners: [], cloudAgents, environments };
  }
  #session(s: AgentSession): RemoteSession {
    return { id: s.id, agent: { id: s.agent.id, name: s.agent.name ?? s.agent.id }, environment_id: s.metadata?.["backchat.environment"] ?? s.environment.type,
      title: s.metadata?.["backchat.title"] ?? s.id, status: s.status === "in_progress" || s.status === "requires_action" ? "running" : s.status === "failed" ? "terminated" : "idle",
      created_at: iso(s.created_at), updated_at: iso(s.last_active_at), metadata: s.metadata };
  }
  async createRemoteSession(input: CloudSessionCreateInput): Promise<RemoteSession> {
    return this.request(async () => this.options.provider === "claude-managed"
      ? await this.claude.beta.sessions.create({ agent: input.agentId, environment_id: input.environmentId, title: input.title, metadata: input.metadata }) as RemoteSession
      : this.#session(await this.openai.beta.agents.sessions.create({ agent_id: input.agentId, environment: input.environmentId === "none" ? { type: "none" } : { type: "openai_hosted" }, metadata: { ...input.metadata, "backchat.title": input.title ?? "", "backchat.environment": input.environmentId } })));
  }
  async listSessions(): Promise<RemoteSession[]> {
    return this.request(async () => {
      const rows: RemoteSession[] = [];
      if (this.options.provider === "claude-managed") for await (const s of this.claude.beta.sessions.list()) rows.push(s as RemoteSession);
      else for await (const s of this.openai.beta.agents.sessions.list()) rows.push(this.#session(s));
      return rows;
    });
  }
  async retrieveSession(id: string, signal?: AbortSignal): Promise<RemoteSession> {
    return this.request(async () => this.options.provider === "claude-managed" ? await this.claude.beta.sessions.retrieve(id, {}, { signal }) as RemoteSession : this.#session(await this.openai.beta.agents.sessions.retrieve(id, { signal })));
  }
  async updateSession(id: string, title: string): Promise<RemoteSession> {
    return this.request(async () => {
      if (this.options.provider === "claude-managed") return await this.claude.beta.sessions.update(id, { title }) as RemoteSession;
      const s = await this.openai.beta.agents.sessions.retrieve(id);
      return this.#session(await this.openai.beta.agents.sessions.update(id, { metadata: { ...s.metadata, "backchat.title": title } }));
    });
  }
  async sendEvent(id: string, event: OpenmaTaskEvent): Promise<void> {
    await this.request(async () => {
      if (this.options.provider === "claude-managed") {
        const { metadata: _metadata, ...input } = event;
        const response = await this.claude.beta.sessions.events.send(id, { events: [input as Parameters<typeof this.claude.beta.sessions.events.send>[1]["events"][number]] }).asResponse();
        await response.body?.cancel(); return;
      }
      const operation = (event.metadata as Record<string, string> | undefined)?.["backchat.operation_id"];
      const events: Parameters<typeof this.openai.beta.agents.sessions.events.create>[1]["events"] = [];
      if (event.type === "user.message") events.push({ type: "agent.session.input.message", input: [{ role: "user", content: [{ type: "input_text", text: text(event.content) }] }] });
      else if (event.type === "user.interrupt") events.push({ type: "agent.session.input.cancel" });
      else if (event.type === "user.custom_tool_result") {
        const s = await this.openai.beta.agents.sessions.retrieve(id);
        const pending = s.required_actions.find(a => a.type === "function_call" && a.call_id === event.custom_tool_use_id);
        if (!pending || pending.type !== "function_call") throw new Error("Tool call is no longer pending");
        events.push({ type: "agent.session.input.tool_result", call_id: pending.call_id, turn_id: pending.turn_id, success: !event.is_error, ...(event.is_error ? { error: text(event.content) } : { output: text(event.content) }) });
      } else throw new Error("Unsupported input event");
      await this.openai.beta.agents.sessions.events.create(id, { events, ...(operation ? { "Idempotency-Key": operation } : {}) });
    });
  }
  #wrap(canonical: OpenMAEvent, wire?: unknown): OpenmaTaskEvent {
    const data = canonical.data as { text?: string };
    return { type: canonical.type, id: canonical.event_id, canonical, ...(typeof data.text === "string" ? { content: data.text } : {}), ...(wire ? { wire } : {}) };
  }
  #event(sessionId: string, id: string, type: CanonicalEventType, data: unknown, turnId?: string, time = new Date().toISOString()): OpenmaTaskEvent {
    return this.#wrap(createOpenMAEvent({ event_id: id, session_id: sessionId, ...(turnId ? { turn_id: turnId } : {}), source: { kind: "harness", harness: this.options.provider }, occurred_at: time, type, data }) as OpenMAEvent);
  }
  #managed(sessionId: string, wire: ManagedStreamEvent): OpenmaTaskEvent[] {
    const raw = wire as unknown as OpenmaTaskEvent;
    if (wire.type === "user.message") this.#turnId = wire.id;
    const canonical = decodeManagedStreamEvent(wire, { sessionId, turnId: this.#turnId, ingestedAt: String(raw.processed_at ?? raw.created_at ?? new Date().toISOString()), ...(wire.type === "event_delta" ? { seq: ++this.#streamIndex } : {}) }).event;
    // The delta counter distinguishes chunks; it is not a durable replay cursor.
    delete canonical.seq;
    const events = [this.#wrap(canonical, wire)];
    if (this.#turnId && (wire.type === "session.status_idle" || wire.type === "session.status_terminated")) {
      const stop = raw.stop_reason as { type?: string } | undefined;
      if (stop?.type !== "requires_action") events.push(this.#event(sessionId, `${raw.id}:turn`, wire.type === "session.status_terminated" ? "turn.cancelled" : "turn.completed", { stop_reason: stop?.type }, this.#turnId));
    }
    return events;
  }
  #item(sessionId: string, item: AgentSessionItem): OpenmaTaskEvent {
    const id = item.id ?? `${item.turn_id}:user`;
    if (item.type === "message") return this.#event(sessionId, `item:${id}:${item.status}`, item.role === "user" ? "user.message" : "agent.message", { message_id: id, text: text(item.content), content: item.content }, item.turn_id);
    if (item.type === "reasoning") return this.#event(sessionId, `item:${id}`, "agent.thinking", { message_id: id, text: text(item.summary) }, item.turn_id);
    if (item.type === "function_call_output") return this.#event(sessionId, `item:${id}`, item.status === "failed" ? "tool.failed" : "tool.completed", { tool_call_id: item.call_id, raw_output: item.output, error: item.error }, item.turn_id);
    if ("status" in item && (item.type.endsWith("_call") || item.type === "command_execution")) {
      const value = item as unknown as Record<string, unknown>;
      return this.#event(sessionId, `item:${id}:${value.status}`, value.status === "failed" ? "tool.failed" : value.status === "completed" ? "tool.completed" : "tool.started", { tool_call_id: value.call_id ?? id, tool_name: value.name ?? item.type, title: value.name ?? item.type, raw_input: value.arguments ?? value.command ?? item, raw_output: value.output, error: value.error }, item.turn_id);
    }
    return this.#vendor(sessionId, `item:${id}`, item.type, item, item.turn_id);
  }
  #vendor(sessionId: string, id: string, name: string, data: unknown, turnId?: string): OpenmaTaskEvent {
    return this.#wrap(createVendorEvent({ event_id: id, session_id: sessionId, ...(turnId ? { turn_id: turnId } : {}), source: { kind: "harness", harness: "openai-agents" }, occurred_at: new Date().toISOString(), harness: "openai-agents", namespace: "agents", name, data }));
  }
  #turn(sessionId: string, turn: RemoteTurn): OpenmaTaskEvent {
    const type = ({ completed: "turn.completed", failed: "turn.failed", cancelled: "turn.cancelled", queued: "turn.queued", in_progress: "session.running", waiting: "session.running" } as const)[turn.status];
    return this.#event(sessionId, `turn:${turn.id}:${turn.status}`, type, { error: turn.error, message: turn.error?.message }, turn.id, iso(turn.completed_at ?? turn.created_at));
  }
  async *history(sessionId: string, options: { afterSeq?: number; signal?: AbortSignal } = {}): AsyncIterable<OpenmaTaskEvent> {
    if (this.options.provider === "claude-managed") {
      this.#turnId = undefined;
      // Official pagination is opaque page-based, not OpenMA's after_seq extension.
      const rows = await this.request(async () => { const result = []; for await (const e of this.claude.beta.sessions.events.list(sessionId, { order: "asc" }, { signal: options.signal })) result.push(e); return result; });
      for (const e of rows) yield* this.#managed(sessionId, e);
    } else {
      const [items, turns] = await this.request(() => Promise.all([
        (async () => { const rows = []; for await (const i of this.openai.beta.agents.sessions.items.list(sessionId, { order: "asc" }, { signal: options.signal })) rows.push(i); return rows; })(),
        (async () => { const rows = []; for await (const t of this.openai.beta.agents.sessions.turns.list(sessionId, { order: "asc" }, { signal: options.signal })) rows.push(t); return rows; })(),
      ]));
      for (const item of items) yield this.#item(sessionId, item);
      for (const turn of turns) if (!turn.subagent_id) yield this.#turn(sessionId, turn);
      const session = await this.request(() => this.openai.beta.agents.sessions.retrieve(sessionId, { signal: options.signal }));
      yield this.#pending(sessionId, `required:${randomUUID()}`, session);
    }
  }
  async openStream(sessionId: string, signal?: AbortSignal): Promise<{ events: AsyncIterable<OpenmaTaskEvent>; close: () => void }> {
    const client = this;
    if (this.options.provider === "claude-managed") {
      const stream = await this.request(() => this.claude.beta.sessions.events.stream(sessionId, { event_deltas: ["agent.message"] }, { signal, timeout: 0 }));
      return { close: () => stream.controller.abort(), events: (async function* () {
        try { for await (const event of stream) yield* client.#managed(sessionId, event); }
        catch (error) { await client.request(() => Promise.reject(error)); }
        finally { stream.controller.abort(); }
      })() };
    }
    const stream = await this.request(() => this.openai.beta.agents.sessions.events.stream(sessionId, { signal, timeout: 0 }));
    return { close: () => stream.controller.abort(), events: (async function* () {
      try { for await (const event of stream) yield* client.#openaiEvent(sessionId, event); }
      catch (error) { await client.request(() => Promise.reject(error)); }
      finally { stream.controller.abort(); }
    })() };
  }
  async *stream(sessionId: string, options: { afterSeq?: number; signal?: AbortSignal } = {}): AsyncIterable<OpenmaTaskEvent> {
    const live = await this.openStream(sessionId, options.signal);
    try { yield* live.events; } finally { live.close(); }
  }
  #pending(sessionId: string, id: string, session: AgentSession): OpenmaTaskEvent {
    // This is desktop pending-input state, separate from the canonical transcript.
    // Keep the complete provider snapshot as a vendor event for replay/debugging.
    const event = this.#vendor(sessionId, id, "required_actions", session.required_actions ?? []);
    event.pendingActions = (session.required_actions ?? []).flatMap(action => action.type === "function_call" ? [{
      id: action.call_id, type: "custom_result", event: { type: "function_call", id: action.call_id, name: action.name, input: action.arguments, turn_id: action.turn_id },
    }] : []);
    return event;
  }
  *#openaiEvent(sessionId: string, event: AgentSessionEvent): Iterable<OpenmaTaskEvent> {
    if (event.type === "agent.session.turn.item.added" || event.type === "agent.session.turn.item.done") { yield this.#item(sessionId, event.item); return; }
    if (event.type === "agent.session.turn.output_text.delta") {
      yield this.#event(sessionId, event.event_id, "agent.message_chunk", { message_id: event.item_id, text: event.delta }, event.turn_id ?? undefined); return;
    }
    if ("turn" in event) { yield this.#turn(sessionId, event.turn); return; }
    if ("session" in event) {
      const type = event.session.status === "idle" ? "session.idle" : event.session.status === "failed" ? "session.error" : "session.running";
      yield this.#event(sessionId, event.event_id, type, { message: event.session.error });
      yield this.#pending(sessionId, `${event.event_id}:required`, event.session);
      return;
    }
    yield this.#vendor(sessionId, event.event_id, event.type, event, "turn_id" in event ? event.turn_id ?? undefined : undefined);
  }
}
