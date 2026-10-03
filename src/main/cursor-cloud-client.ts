import { createHash } from "node:crypto";
import type { CursorCloudSseEvent } from "@openma/common/protocol/cursor-cloud";

export class CursorCloudRequestError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  constructor(status: number | undefined, code: string | undefined, message: string) {
    super(message);
    this.name = "CursorCloudRequestError";
    this.status = status;
    this.code = code;
  }
  get busy(): boolean { return this.status === 409 && this.code === "agent_busy"; }
  /** A definite rejection is not retried and is not left as an uncertain send. */
  get definitelyRejected(): boolean {
    return this.status !== undefined && [400, 401, 403, 404, 405, 413, 415, 422].includes(this.status);
  }
}

export interface CursorAgentRecord {
  id: string;
  name?: string;
  status: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
  latestRunId?: string;
  env?: { type?: string; name?: string };
  repos?: Array<{ url?: string; startingRef?: string }>;
}

export interface CursorRunRecord {
  id: string;
  agentId?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  result?: string;
  durationMs?: number;
  git?: { branches?: Array<{ repoUrl?: string; branch?: string; prUrl?: string }> };
}

export interface CursorConversationMessage {
  type: string;
  text?: string;
}

interface RepositoryCacheEntry {
  at: number;
  items: Array<{ url: string }>;
  fetches: number[];
  pending?: Promise<Array<{ url: string }>>;
}

const repositoryCache = new Map<string, RepositoryCacheEntry>();

export function resetCursorRepositoryCache(): void {
  repositoryCache.clear();
}

export function cursorCloudAuthorization(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`, "utf8").toString("base64")}`;
}

export function cursorCloudRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function cacheKey(baseUrl: string, apiKey: string): string {
  return createHash("sha256").update(`${cursorCloudRoot(baseUrl)}\n${apiKey}`).digest("hex");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const timer = setTimeout(finish, ms);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    function finish() { signal?.removeEventListener("abort", onAbort); resolve(); }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function parseCursorSseFrame(raw: string): CursorCloudSseEvent | undefined {
  let eventName: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];
  let sawDispatchField = false;
  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") { eventName = value; sawDispatchField = true; }
    else if (field === "id") { if (value.length > 0) id = value; sawDispatchField = true; }
    else if (field === "data") { dataLines.push(value); sawDispatchField = true; }
  }
  if (!sawDispatchField) return undefined;
  const dataText = dataLines.join("\n");
  let data: unknown = dataText;
  if (dataText) {
    try { data = JSON.parse(dataText); } catch { data = dataText; }
  } else data = {};
  return { event: eventName && eventName.length > 0 ? eventName : "message", ...(id ? { id } : {}), data };
}

export async function* readCursorSseEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<CursorCloudSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let splitAt = buffer.indexOf("\n\n");
      while (splitAt !== -1) {
        const parsed = parseCursorSseFrame(buffer.slice(0, splitAt));
        buffer = buffer.slice(splitAt + 2);
        if (parsed) yield parsed;
        splitAt = buffer.indexOf("\n\n");
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  if (!signal?.aborted && buffer.trim()) {
    const trailing = parseCursorSseFrame(buffer);
    if (trailing) yield trailing;
  }
}

function agentFrom(value: unknown): CursorAgentRecord | null {
  const body = record(value);
  if (!body || typeof body.id !== "string") return null;
  const env = record(body.env);
  const repos = Array.isArray(body.repos) ? body.repos.flatMap((item) => {
    const repo = record(item);
    return repo ? [{ ...(typeof repo.url === "string" ? { url: repo.url } : {}), ...(typeof repo.startingRef === "string" ? { startingRef: repo.startingRef } : {}) }] : [];
  }) : undefined;
  return {
    id: body.id,
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    status: typeof body.status === "string" ? body.status : "ACTIVE",
    ...(typeof body.url === "string" ? { url: body.url } : {}),
    createdAt: typeof body.createdAt === "string" ? body.createdAt : new Date(0).toISOString(),
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : new Date(0).toISOString(),
    ...(typeof body.latestRunId === "string" ? { latestRunId: body.latestRunId } : {}),
    ...(env ? { env: { ...(typeof env.type === "string" ? { type: env.type } : {}), ...(typeof env.name === "string" ? { name: env.name } : {}) } } : {}),
    ...(repos ? { repos } : {}),
  };
}

function runFrom(value: unknown): CursorRunRecord | null {
  const body = record(value);
  if (!body || typeof body.id !== "string") return null;
  const git = record(body.git);
  const branches = Array.isArray(git?.branches) ? git.branches.flatMap((item) => {
    const branch = record(item);
    if (!branch) return [];
    return [{
      ...(typeof branch.repoUrl === "string" ? { repoUrl: branch.repoUrl } : {}),
      ...(typeof branch.branch === "string" ? { branch: branch.branch } : {}),
      ...(typeof branch.prUrl === "string" ? { prUrl: branch.prUrl } : {}),
    }];
  }) : undefined;
  return {
    id: body.id,
    ...(typeof body.agentId === "string" ? { agentId: body.agentId } : {}),
    status: typeof body.status === "string" ? body.status : "",
    ...(typeof body.createdAt === "string" ? { createdAt: body.createdAt } : {}),
    ...(typeof body.updatedAt === "string" ? { updatedAt: body.updatedAt } : {}),
    ...(typeof body.result === "string" ? { result: body.result } : {}),
    ...(typeof body.durationMs === "number" ? { durationMs: body.durationMs } : {}),
    ...(branches ? { git: { branches } } : {}),
  };
}

export interface CursorCloudClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
  repositoryMinIntervalMs?: number;
  repositoryHourMax?: number;
}

export class CursorCloudClient {
  constructor(private options: CursorCloudClientOptions) {}

  async listModels(signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> {
    const body = await this.#json("/v1/models", { signal });
    const items = Array.isArray(record(body)?.items) ? record(body)!.items as unknown[] : [];
    return items.flatMap((item) => {
      const model = record(item);
      if (!model || typeof model.id !== "string") return [];
      return [{ id: model.id, name: typeof model.displayName === "string" && model.displayName ? model.displayName : model.id }];
    });
  }

  async listRepositories(options: { waitMs?: number; signal?: AbortSignal } = {}): Promise<Array<{ url: string }>> {
    const key = cacheKey(this.options.baseUrl, this.options.apiKey);
    const minInterval = this.options.repositoryMinIntervalMs ?? 60_000;
    const hourMax = this.options.repositoryHourMax ?? 30;
    const now = Date.now();
    const current = repositoryCache.get(key);
    const fetches = (current?.fetches ?? []).filter((at) => now - at < 60 * 60 * 1000);
    if (current && now - current.at < minInterval) return current.items;
    if (fetches.length >= hourMax) return current?.items ?? [];
    if (!current?.pending) {
      const pending = this.#json("/v1/repositories", { signal: options.signal }).then((body) => {
        const items = Array.isArray(record(body)?.items) ? (record(body)!.items as unknown[]).flatMap((item) => {
          const repo = record(item);
          return repo && typeof repo.url === "string" ? [{ url: repo.url }] : [];
        }) : [];
        const stamp = Date.now();
        const previous = repositoryCache.get(key);
        repositoryCache.set(key, {
          at: stamp,
          items,
          fetches: [...(previous?.fetches ?? fetches), stamp].filter((at) => stamp - at < 60 * 60 * 1000),
        });
        return items;
      }).catch((error: unknown) => {
        const previous = repositoryCache.get(key);
        const stamp = Date.now();
        const rateLimited = error instanceof CursorCloudRequestError && error.status === 429;
        const kept = previous?.items ?? [];
        repositoryCache.set(key, {
          at: rateLimited ? stamp : previous?.at ?? 0,
          items: kept,
          fetches: [...fetches, stamp].filter((at) => stamp - at < 60 * 60 * 1000),
        });
        if (rateLimited) return kept;
        throw error;
      });
      repositoryCache.set(key, { at: current?.at ?? 0, items: current?.items ?? [], fetches, pending });
    }
    const pending = repositoryCache.get(key)?.pending;
    if (!pending) return repositoryCache.get(key)?.items ?? [];
    const waitMs = options.waitMs ?? 0;
    if (waitMs <= 0) return pending;
    return Promise.race([
      pending,
      delay(waitMs).then(() => repositoryCache.get(key)?.items ?? []),
    ]);
  }

  async listAgents(signal?: AbortSignal): Promise<CursorAgentRecord[]> {
    const agents: CursorAgentRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const path = cursor ? `/v1/agents?limit=100&cursor=${encodeURIComponent(cursor)}` : "/v1/agents?limit=100";
      const body = record(await this.#json(path, { signal }));
      const items = Array.isArray(body?.items) ? body.items : [];
      for (const item of items) {
        const agent = agentFrom(item);
        if (agent) agents.push(agent);
      }
      cursor = typeof body?.nextCursor === "string" && body.nextCursor ? body.nextCursor : undefined;
      if (!cursor) break;
    }
    return agents;
  }

  async getAgent(id: string, signal?: AbortSignal): Promise<CursorAgentRecord | null> {
    const response = await this.#response(`/v1/agents/${encodeURIComponent(id)}`, { signal });
    if (response.status === 404) { await response.body?.cancel(); return null; }
    return agentFrom(await this.#read(response));
  }

  async createAgent(body: Record<string, unknown>, signal?: AbortSignal): Promise<{ agent: CursorAgentRecord; run: CursorRunRecord }> {
    const payload = record(await this.#json("/v1/agents", { method: "POST", body: JSON.stringify(body), signal }));
    const agent = agentFrom(payload?.agent);
    const run = runFrom(payload?.run);
    if (!agent || !run) throw new CursorCloudRequestError(undefined, "validation_error", "Cursor Cloud did not return an agent and run");
    return { agent, run };
  }

  async createRun(id: string, text: string, signal?: AbortSignal): Promise<CursorRunRecord> {
    const payload = record(await this.#json(`/v1/agents/${encodeURIComponent(id)}/runs`, {
      method: "POST", body: JSON.stringify({ prompt: { text } }), signal,
    }));
    const run = runFrom(payload?.run);
    if (!run) throw new CursorCloudRequestError(undefined, "validation_error", "Cursor Cloud did not return a run");
    return run;
  }

  async cancelRun(id: string, runId: string, signal?: AbortSignal): Promise<void> {
    await this.#json(`/v1/agents/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", signal });
  }

  async getRun(id: string, runId: string, signal?: AbortSignal): Promise<CursorRunRecord> {
    const run = runFrom(await this.#json(`/v1/agents/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`, { signal }));
    if (!run) throw new CursorCloudRequestError(undefined, "validation_error", "Cursor Cloud did not return a run");
    return run;
  }

  async listRuns(id: string, signal?: AbortSignal): Promise<CursorRunRecord[]> {
    const runs: CursorRunRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const path = `/v1/agents/${encodeURIComponent(id)}/runs?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const body = record(await this.#json(path, { signal }));
      const items = Array.isArray(body?.items) ? body.items : [];
      for (const item of items) {
        const run = runFrom(item);
        if (run) runs.push(run);
      }
      cursor = typeof body?.nextCursor === "string" && body.nextCursor ? body.nextCursor : undefined;
      if (!cursor) break;
    }
    return runs;
  }

  async conversation(id: string, signal?: AbortSignal): Promise<CursorConversationMessage[] | null> {
    const response = await this.#response(`/v0/agents/${encodeURIComponent(id)}/conversation`, { signal });
    if (response.status === 404 || response.status === 410 || response.status === 501) {
      await response.body?.cancel();
      return null;
    }
    const body = record(await this.#read(response));
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    return messages.flatMap((item) => {
      const message = record(item);
      if (!message || typeof message.type !== "string") return [];
      return [{ type: message.type, ...(typeof message.text === "string" ? { text: message.text } : {}) }];
    });
  }

  async openRunStream(id: string, runId: string, lastEventId: string | undefined, signal?: AbortSignal): Promise<Response> {
    const response = await this.#response(`/v1/agents/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/stream`, {
      headers: {
        Accept: "text/event-stream",
        ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
      },
      signal,
    });
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {});
      this.options.onUnauthorized?.();
      throw new CursorCloudRequestError(401, "unauthorized", "Cursor Cloud request failed (401 unauthorized)");
    }
    return response;
  }

  async #json(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<unknown> {
    return this.#read(await this.#response(path, init));
  }

  async #read(response: Response): Promise<unknown> {
    if (!response.ok) throw await errorFrom(response, this.options.onUnauthorized);
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text) as unknown; }
    catch { throw new CursorCloudRequestError(response.status, "validation_error", "Cursor Cloud returned an unreadable response"); }
  }

  async #response(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", cursorCloudAuthorization(this.options.apiKey));
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(`${cursorCloudRoot(this.options.baseUrl)}${path}`, { ...init, headers });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new CursorCloudRequestError(undefined, undefined, "Cursor Cloud connection interrupted");
    }
    return response;
  }
}

async function errorFrom(response: Response, onUnauthorized?: () => void): Promise<CursorCloudRequestError> {
  let code: string | undefined;
  try {
    const body = record(JSON.parse(await response.text()));
    const error = record(body?.error);
    if (typeof error?.code === "string") code = error.code;
  } catch { /* The status is the safe part of a third-party error. */ }
  if (response.status === 401) onUnauthorized?.();
  const busy = response.status === 409 && code === "agent_busy";
  return new CursorCloudRequestError(
    response.status,
    code,
    busy ? "Cursor Cloud Agent is still running" : `Cursor Cloud request failed (${response.status}${code ? ` ${code}` : ""})`,
  );
}

export { delay as cursorCloudDelay };
