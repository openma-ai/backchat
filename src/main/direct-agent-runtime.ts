import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AgentSession, AgentSessionEvent, AgentSessionItem } from "openai/resources/beta/agents/agents";
import type { Turn as RemoteTurn } from "openai/resources/beta/agents/sessions/turns";
import { decodeManagedStreamEvent, type ManagedStreamEvent } from "@openma/common/protocol/managed";
import {
  decodeOpenAIAgentsItem,
  decodeOpenAIAgentsPendingActions,
  decodeOpenAIAgentsStreamEvent,
  decodeOpenAIAgentsTurn,
  type OpenAIAgentsDecodeContext,
  type OpenAIAgentsItem,
  type OpenAIAgentsStreamEvent,
  type OpenAIAgentsTurn,
} from "@openma/common/protocol/openai-agents";
import { createOpenMAEvent, type OpenMAEvent, type CanonicalEventType } from "@openma/common/session-events/openma";
import type { DirectAgentProvider, OpenmaCatalog, OpenmaTaskEvent } from "../shared/openma.js";
import type { CloudSessionCreateInput } from "./openmanaged-cloud-runtime.js";
import { CursorCloudClient } from "./cursor-cloud-client.js";
import { CursorCloudRuntime, type CursorCloudSendResult } from "./cursor-cloud-runtime.js";

export interface RemoteSession {
  resources?: unknown[];
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
  #cursorRuntime?: CursorCloudRuntime;
  constructor(readonly options: Options) {
    this.claude = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseUrl, fetch: options.fetchImpl, maxRetries: 0, timeout: 30_000 });
    this.openai = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl, fetch: options.fetchImpl, maxRetries: 0, timeout: 30_000 });
  }
  #cursor(): CursorCloudRuntime | null {
    if (this.options.provider !== "cursor-cloud") return null;
    this.#cursorRuntime ??= new CursorCloudRuntime(new CursorCloudClient({
      baseUrl: this.options.baseUrl, apiKey: this.options.apiKey, fetchImpl: this.options.fetchImpl, onUnauthorized: this.options.onUnauthorized,
    }));
    return this.#cursorRuntime;
  }
  #openaiContext(sessionId: string): OpenAIAgentsDecodeContext {
    return { sessionId, now: () => new Date().toISOString() };
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
    const cursor = this.#cursor();
    if (cursor) return cursor.catalog();
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
    const cursor = this.#cursor();
    if (cursor) return cursor.createRemoteSession(input);
    return this.request(async () => this.options.provider === "claude-managed"
      ? await this.claude.beta.sessions.create({ agent: input.agentId, environment_id: input.environmentId, title: input.title, metadata: input.metadata }) as RemoteSession
      : this.#session(await this.openai.beta.agents.sessions.create({ agent_id: input.agentId, environment: input.environmentId === "none" ? { type: "none" } : { type: "openai_hosted" }, metadata: { ...input.metadata, "backchat.title": input.title ?? "", "backchat.environment": input.environmentId } })));
  }
  async listSessions(): Promise<RemoteSession[]> {
    const cursor = this.#cursor();
    if (cursor) return cursor.listSessions();
    return this.request(async () => {
      const rows: RemoteSession[] = [];
      if (this.options.provider === "claude-managed") for await (const s of this.claude.beta.sessions.list()) rows.push(s as RemoteSession);
      else for await (const s of this.openai.beta.agents.sessions.list()) rows.push(this.#session(s));
      return rows;
    });
  }
  async retrieveSession(id: string, signal?: AbortSignal): Promise<RemoteSession> {
    const cursor = this.#cursor();
    if (cursor) return cursor.retrieveSession(id, signal);
    return this.request(async () => this.options.provider === "claude-managed" ? await this.claude.beta.sessions.retrieve(id, {}, { signal }) as RemoteSession : this.#session(await this.openai.beta.agents.sessions.retrieve(id, { signal })));
  }
  async updateSession(id: string, title: string): Promise<RemoteSession> {
    const cursor = this.#cursor();
    if (cursor) return cursor.updateSession(id, title);
    return this.request(async () => {
      if (this.options.provider === "claude-managed") return await this.claude.beta.sessions.update(id, { title }) as RemoteSession;
      const s = await this.openai.beta.agents.sessions.retrieve(id);
      return this.#session(await this.openai.beta.agents.sessions.update(id, { metadata: { ...s.metadata, "backchat.title": title } }));
    });
  }
  async sendEvent(id: string, event: OpenmaTaskEvent, idempotencyKey?: string): Promise<CursorCloudSendResult | void> {
    const cursor = this.#cursor();
    if (cursor) return cursor.sendEvent(id, event, idempotencyKey);
    await this.request(async () => {
      if (this.options.provider === "claude-managed") {
        const { metadata: _metadata, ...input } = event;
        const response = await this.claude.beta.sessions.events.send(id, { events: [input as Parameters<typeof this.claude.beta.sessions.events.send>[1]["events"][number]] }).asResponse();
        await response.body?.cancel(); return;
      }
      const operation = idempotencyKey ?? (event.metadata as Record<string, string> | undefined)?.["backchat.operation_id"];
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
    return this.#wrap(decodeOpenAIAgentsItem(item as OpenAIAgentsItem, this.#openaiContext(sessionId)));
  }
  #turn(sessionId: string, turn: RemoteTurn): OpenmaTaskEvent {
    return this.#wrap(decodeOpenAIAgentsTurn(turn as unknown as OpenAIAgentsTurn, this.#openaiContext(sessionId)));
  }
  async *history(sessionId: string, options: { afterSeq?: number; preferLocal?: boolean; signal?: AbortSignal } = {}): AsyncIterable<OpenmaTaskEvent> {
    const cursor = this.#cursor();
    if (cursor) { yield* cursor.history(sessionId, options); return; }
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
    const cursor = this.#cursor();
    if (cursor) return cursor.openStream(sessionId, signal);
    const client = this;
    if (this.options.provider === "claude-managed") {
      const stream = await this.request(() => this.claude.beta.sessions.events.stream(sessionId, { event_deltas: ["agent.message"] }, { signal }));
      return { close: () => stream.controller.abort(), events: (async function* () {
        try { for await (const event of stream) yield* client.#managed(sessionId, event); }
        catch (error) { await client.request(() => Promise.reject(error)); }
        finally { stream.controller.abort(); }
      })() };
    }
    const stream = await this.request(() => this.openai.beta.agents.sessions.events.stream(sessionId, { signal }));
    return { close: () => stream.controller.abort(), events: (async function* () {
      try { for await (const event of stream) yield* client.#openaiEvent(sessionId, event); }
      catch (error) { await client.request(() => Promise.reject(error)); }
      finally { stream.controller.abort(); }
    })() };
  }
  async *stream(sessionId: string, options: { afterSeq?: number; signal?: AbortSignal; onConnected?: () => void } = {}): AsyncIterable<OpenmaTaskEvent> {
    const live = await this.openStream(sessionId, options.signal);
    try { options.onConnected?.(); yield* live.events; } finally { live.close(); }
  }
  #pending(sessionId: string, id: string, session: AgentSession): OpenmaTaskEvent {
    // Desktop pending-input state stays here. The vendor record comes from the shared decoder.
    const decoded = decodeOpenAIAgentsPendingActions(session as unknown as Parameters<typeof decodeOpenAIAgentsPendingActions>[0], { ...this.#openaiContext(sessionId), eventId: id });
    const event = this.#wrap(decoded.event);
    event.pendingActions = decoded.functionCalls.map((action) => ({
      id: action.call_id, type: "custom_result", event: { type: "function_call", id: action.call_id, name: action.name, input: action.arguments, turn_id: action.turn_id },
    }));
    return event;
  }
  *#openaiEvent(sessionId: string, event: AgentSessionEvent): Iterable<OpenmaTaskEvent> {
    const decoded = decodeOpenAIAgentsStreamEvent(event as unknown as OpenAIAgentsStreamEvent, this.#openaiContext(sessionId));
    if ("session" in event && event.session) {
      for (const item of decoded) {
        if (item.type === "vendor.event") yield this.#pending(sessionId, `${event.event_id}:required`, event.session);
        else yield this.#wrap(item);
      }
      return;
    }
    for (const item of decoded) yield this.#wrap(item);
  }
}
