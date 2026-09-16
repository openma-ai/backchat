import { Anthropic, OpenMA } from "@openma/sdk";
import { Stream } from "@anthropic-ai/sdk/core/streaming";

export interface OpenManagedCloudRuntimeOptions {
  baseUrl: string;
  apiKey: string;
  workspaceId?: string;
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
}
export interface CloudSessionCreateInput { agentId: string; environmentId: string; title?: string; metadata?: Record<string, string> }
export interface CloudSessionCreateResult { sessionId: string }
export type OpenmaRemoteEvent = Record<string, unknown> & { type: string; id?: string; seq?: number };

/** SDK transport only. Submission and observation are independent so resuming
 * a subscription cannot replay a user instruction. Runtime ownership lives above it. */
export class OpenManagedCloudRuntimeClient {
  readonly sdk: OpenMA;
  #onUnauthorized?: () => void;
  constructor(options: OpenManagedCloudRuntimeOptions) {
    this.#onUnauthorized = options.onUnauthorized;
    this.sdk = new OpenMA({
      baseURL: options.baseUrl.replace(/\/$/, ""), apiKey: options.apiKey,
      activeTenantId: options.workspaceId, fetch: options.fetchImpl,
      // A timed-out POST may already have been accepted. Let history reconcile
      // the outcome instead of automatically issuing the operation again.
      maxRetries: 0, timeout: 30_000,
    });
  }

  async request<T>(operation: () => PromiseLike<T>): Promise<T> {
    try { return await operation(); } catch (error) { throw this.publicError(error); }
  }

  publicError(error: unknown): Error {
    if (error instanceof Anthropic.APIError) {
      if (error.status === 401) this.#onUnauthorized?.();
      return new Error(error.status === 401 ? "OpenMA authorization expired. Sign in again."
        : `OpenMA request failed (${error.status ?? "connection"}). Refresh the task to check its current state.`);
    }
    if (error instanceof Error && error.name === "AbortError") return error;
    return new Error("OpenMA connection interrupted. Refresh the task before retrying an action.");
  }

  async createSession(input: CloudSessionCreateInput): Promise<CloudSessionCreateResult> {
    const session = await this.request(() => this.sdk.beta.sessions.create({
      agent: input.agentId, environment_id: input.environmentId, title: input.title ?? "",
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }));
    if (!session.id) throw new Error("OpenMA did not return a session ID");
    return { sessionId: session.id };
  }

  async sendMessage(sessionId: string, text: string): Promise<OpenmaRemoteEvent[]> {
    const response = await this.request(() => this.sdk.beta.sessions.events.send(sessionId, {
      events: [{ type: "user.message", content: [{ type: "text", text }] }],
    }).asResponse());
    if (response.status === 202 || response.status === 204) { await response.body?.cancel(); return []; }
    const body = await response.text();
    return body ? (JSON.parse(body).data ?? []) as OpenmaRemoteEvent[] : [];
  }

  async sendEvent(sessionId: string, event: OpenmaRemoteEvent): Promise<void> {
    type InputEvent = Parameters<typeof this.sdk.beta.sessions.events.send>[1]["events"][number];
    const response = await this.request(() => this.sdk.beta.sessions.events.send(sessionId, { events: [event as InputEvent] }).asResponse());
    // No response event is required for an accepted mutation. Some v1 servers
    // add application/json to an empty 202; parsing that body invents a failure.
    await response.body?.cancel().catch(() => {});
  }

  async *history(sessionId: string, options: { afterSeq?: number; signal?: AbortSignal } = {}): AsyncIterable<OpenmaRemoteEvent> {
    let cursor = options.afterSeq ?? 0;
    while (!options.signal?.aborted) {
      // The v1 history route returns stored rows and uses after_seq, whereas
      // SDK auto-pagination sends an opaque page token. Keep the SDK transport
      // and explicitly adapt the existing server's pagination contract.
      const page = await this.request(() => this.sdk.beta.sessions.events.list(sessionId, { order: "asc" }, {
        query: { after_seq: cursor, limit: 500 }, signal: options.signal,
      }));
      let next = cursor;
      for (const value of page.data ?? []) {
        const raw = value as unknown as OpenmaRemoteEvent & { data?: OpenmaRemoteEvent; ts?: number };
        const event: OpenmaRemoteEvent = raw.data && typeof raw.ts === "number"
          ? { ...raw.data, type: raw.type, seq: raw.seq, processed_at: raw.data.processed_at ?? new Date(raw.ts).toISOString() }
          : raw;
        if (typeof event.seq === "number") next = Math.max(next, event.seq);
        yield event;
      }
      if (!page.hasNextPage()) return;
      if (next <= cursor) throw new Error("OpenMA history cursor did not advance");
      cursor = next;
    }
  }

  async *stream(sessionId: string, options: { afterSeq?: number; signal?: AbortSignal } = {}): AsyncIterable<OpenmaRemoteEvent> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    try {
    const response = await this.request(() => this.sdk.beta.sessions.events.stream(sessionId, {
      event_deltas: ["agent.message", "agent.thinking"],
    }, {
      signal: controller.signal,
      // OpenMA admits transient message/tool chunks through this extension;
      // the SDK's event_deltas parameter alone selects only spec events.
      query: { include: "chunks" },
      headers: { "Last-Event-ID": String(options.afterSeq ?? 0) },
      timeout: 0,
    }).asResponse());
      // The standard parsed stream filters event names against Anthropic's
      // schema. OpenMA adds chunks and pending-input frames. Decode framing,
      // fragmented UTF-8 and multiline data with the SDK's public raw reader.
      for await (const frame of Stream.rawEvents(response, controller)) {
        if (frame.event === "ping" || !frame.data || frame.data === "[DONE]") continue;
        if (frame.event === "error") throw new Error("OpenMA stream failed");
        const event = JSON.parse(frame.data) as OpenmaRemoteEvent;
        if (event && typeof event.type === "string") yield event;
      }
    } catch (error) { if (!options.signal?.aborted) throw this.publicError(error); }
    finally { controller.abort(); options.signal?.removeEventListener("abort", abort); }
  }

  async interrupt(sessionId: string, threadId?: string): Promise<void> {
    // Thread routing is an OpenMA extension to the official input event.
    const event = { type: "user.interrupt" as const, ...(threadId ? { session_thread_id: threadId } : {}) };
    await this.sendEvent(sessionId, event);
  }
}
