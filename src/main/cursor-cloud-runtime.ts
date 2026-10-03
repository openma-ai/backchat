import { randomUUID } from "node:crypto";
import {
  decodeCursorCloudRunStreamEvent,
  type CursorCloudDecodeContext,
  type CursorCloudSseEvent,
} from "@openma/common/protocol/cursor-cloud";
import type { OpenMAEvent } from "@openma/common/session-events/openma";
import type { CursorCloudBinding, OpenmaCatalog, OpenmaTaskEvent } from "../shared/openma.js";
import type { CloudSessionCreateInput } from "./openmanaged-cloud-runtime.js";
import {
  CursorCloudClient,
  CursorCloudRequestError,
  cursorCloudDelay,
  readCursorSseEvents,
  type CursorAgentRecord,
  type CursorRunRecord,
} from "./cursor-cloud-client.js";
import { cursorRepositoryUrl } from "./cursor-cloud-git.js";

const TERMINAL_RUN = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

export interface CursorRemoteSession {
  resources?: unknown[];
  id: string;
  agent: { id: string; name?: string };
  environment_id: string;
  title: string;
  status: "idle" | "running" | "rescheduling" | "terminated";
  created_at: string;
  updated_at: string;
  metadata?: Record<string, string> | null;
}

function text(content: unknown): string {
  return typeof content === "string" ? content : Array.isArray(content) ? content.map((block: { text?: unknown }) => block?.text ?? "").join("") : "";
}

function wrap(canonical: OpenMAEvent): OpenmaTaskEvent {
  const data = canonical.data as { text?: string };
  return { type: canonical.type, id: canonical.event_id, canonical, ...(typeof data.text === "string" ? { content: data.text } : {}) };
}

function metadata(event: OpenmaTaskEvent): Record<string, string> {
  const value = event.metadata;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => typeof item === "string" ? [[key, item]] : []));
}

export function cursorRemoteStatus(agent: CursorAgentRecord, runStatus?: string): CursorRemoteSession["status"] {
  if (agent.status === "ARCHIVED") return "terminated";
  if (agent.status === "IDLE" || (runStatus !== undefined && TERMINAL_RUN.has(runStatus))) return "idle";
  if (agent.status === "ACTIVE" || runStatus === "CREATING" || runStatus === "RUNNING") return "running";
  return "idle";
}

function toRemoteSession(agent: CursorAgentRecord, runStatus?: string, title?: string): CursorRemoteSession {
  const repo = agent.repos?.find((item) => item.url);
  return {
    id: agent.id,
    agent: { id: "cursor-cloud", name: agent.name || "Cursor Cloud" },
    environment_id: agent.env?.type || "cloud",
    title: title ?? agent.name ?? agent.id,
    status: cursorRemoteStatus(agent, runStatus),
    created_at: agent.createdAt,
    updated_at: agent.updatedAt,
    metadata: {
      ...(agent.url ? { "backchat.cursor.url": agent.url } : {}),
      ...(repo?.url ? { "backchat.cursor.repo": repo.url } : {}),
      ...(repo?.startingRef ? { "backchat.cursor.branch": repo.startingRef } : {}),
      ...(agent.latestRunId ? { "backchat.cursor.run": agent.latestRunId } : {}),
    },
  };
}

function placeholder(id: string, title: string, binding?: CursorCloudBinding): CursorRemoteSession {
  const now = new Date().toISOString();
  return {
    id,
    agent: { id: "cursor-cloud", name: "Cursor Cloud" },
    environment_id: "cloud",
    title,
    status: "idle",
    created_at: now,
    updated_at: now,
    metadata: {
      "backchat.cursor.pending": "1",
      ...(binding?.repoUrl ? { "backchat.cursor.repo": binding.repoUrl } : {}),
      ...(binding?.startingRef ? { "backchat.cursor.branch": binding.startingRef } : {}),
    },
  };
}

function context(sessionId: string, turnId: string, now: () => string): CursorCloudDecodeContext {
  return { sessionId, turnId, now };
}

export interface CursorCloudSendResult { runId?: string }

/** Cursor Cloud Agents API v1, decoded only through `@openma/common/protocol/cursor-cloud`. */
export class CursorCloudRuntime {
  readonly client: CursorCloudClient;
  constructor(client: CursorCloudClient, private now: () => string = () => new Date().toISOString()) {
    this.client = client;
  }

  async catalog(): Promise<OpenmaCatalog> {
    const models = await this.client.listModels();
    const repositories = await this.client.listRepositories({ waitMs: 1_500 }).catch((error: unknown) => {
      if (error instanceof CursorCloudRequestError && error.status === 401) throw error;
      return [];
    });
    const cloudAgents = [{ id: "default", name: "Default" }];
    for (const model of models) {
      if (model.id !== "default") cloudAgents.push({ id: model.id, name: model.name });
    }
    return {
      runners: [],
      cloudAgents,
      environments: [{ id: "cloud", name: "Cursor Cloud", type: "cloud", runtimeId: null }],
      ...(repositories.length ? { repositories } : {}),
    };
  }

  /** Creation waits for the first prompt. Cursor rejects `POST /v1/agents` without one. */
  createRemoteSession(input: CloudSessionCreateInput): CursorRemoteSession {
    return placeholder(`bc-${randomUUID()}`, input.title ?? "", input.cursor);
  }

  async listSessions(signal?: AbortSignal): Promise<CursorRemoteSession[]> {
    return (await this.client.listAgents(signal)).map((agent) => toRemoteSession(agent));
  }

  async retrieveSession(id: string, signal?: AbortSignal): Promise<CursorRemoteSession> {
    const agent = await this.client.getAgent(id, signal);
    if (!agent) return placeholder(id, id);
    let runStatus: string | undefined;
    if (agent.latestRunId && agent.status !== "ARCHIVED" && agent.status !== "IDLE") {
      runStatus = (await this.client.getRun(id, agent.latestRunId, signal)).status;
    }
    return toRemoteSession(agent, runStatus);
  }

  /** v1 has no rename. The title stays on the desktop task. */
  async updateSession(id: string, title: string, signal?: AbortSignal): Promise<CursorRemoteSession> {
    const session = await this.retrieveSession(id, signal);
    return { ...session, title };
  }

  async sendEvent(id: string, event: OpenmaTaskEvent, _idempotencyKey?: string, signal?: AbortSignal): Promise<CursorCloudSendResult> {
    if (event.type === "user.custom_tool_result") {
      throw new CursorCloudRequestError(400, "validation_error", "Cursor Cloud Agents do not accept client tool results");
    }
    if (event.type === "user.interrupt") {
      const agent = await this.client.getAgent(id, signal);
      if (!agent?.latestRunId) throw new CursorCloudRequestError(409, "run_not_cancellable", "Cursor Cloud request failed (409 run_not_cancellable)");
      await this.client.cancelRun(id, agent.latestRunId, signal);
      return { runId: agent.latestRunId };
    }
    if (event.type !== "user.message") throw new CursorCloudRequestError(400, "validation_error", "Unsupported input event");
    const prompt = text(event.content).trim();
    if (!prompt) throw new CursorCloudRequestError(400, "validation_error", "Enter a message");
    const fields = metadata(event);
    const repo = fields["backchat.cursor.repo"]?.trim();
    const branch = fields["backchat.cursor.branch"]?.trim();
    const model = fields["backchat.cursor.model"]?.trim();
    const title = fields["backchat.cursor.title"]?.trim();
    const repository = repo ? cursorRepositoryUrl(repo) : null;
    if (repo && !repository) throw new CursorCloudRequestError(400, "validation_error", "Enter a repository URL such as https://github.com/org/repo");

    const existing = await this.client.getAgent(id, signal);
    if (!existing) {
      try {
        const created = await this.client.createAgent({
          agentId: id,
          prompt: { text: prompt },
          ...(title ? { name: title.slice(0, 100) } : {}),
          ...(model && model !== "default" ? { model: { id: model } } : {}),
          ...(repository ? { repos: [{ url: repository, ...(branch ? { startingRef: branch } : {}) }] } : {}),
        }, signal);
        return { runId: created.run.id };
      } catch (error) {
        if (error instanceof CursorCloudRequestError && error.code === "agent_id_conflict") {
          const agent = await this.client.getAgent(id, signal);
          return { runId: agent?.latestRunId };
        }
        throw error;
      }
    }
    if (existing.status === "ARCHIVED") throw new CursorCloudRequestError(409, "agent_archived", "Cursor Cloud request failed (409 agent_archived)");
    const run = await this.client.createRun(id, prompt, signal);
    return { runId: run.id };
  }

  async *history(sessionId: string, options: { preferLocal?: boolean; signal?: AbortSignal } = {}): AsyncIterable<OpenmaTaskEvent> {
    if (options.preferLocal) return;
    try {
      const messages = await this.client.conversation(sessionId, options.signal);
      if (messages?.length) {
        let turn = 0;
        for (const [index, message] of messages.entries()) {
          if (message.type === "user_message") turn = index;
          const sse = conversationEvent(index, message);
          if (!sse) continue;
          yield* this.#decode(sessionId, `v0:${turn}`, sse);
        }
        return;
      }
      const runs = [...await this.client.listRuns(sessionId, options.signal)].reverse();
      for (const run of runs) yield* this.#decode(sessionId, run.id, runEvent(run));
    } catch (error) {
      if (error instanceof CursorCloudRequestError && error.status === 404) return;
      throw error;
    }
  }

  async openStream(sessionId: string, signal?: AbortSignal): Promise<{ events: AsyncIterable<OpenmaTaskEvent>; close: () => void }> {
    await this.client.getAgent(sessionId, signal);
    const controller = new AbortController();
    const linked = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    return { close: () => controller.abort(), events: this.#follow(sessionId, linked) };
  }

  *#decode(sessionId: string, turnId: string, event: CursorCloudSseEvent): Iterable<OpenmaTaskEvent> {
    for (const decoded of decodeCursorCloudRunStreamEvent(event, context(sessionId, turnId, this.now))) yield wrap(decoded);
  }

  async *#follow(sessionId: string, signal: AbortSignal): AsyncIterable<OpenmaTaskEvent> {
    let lastEventId: string | undefined;
    let runId: string | undefined;
    const seen = new Set<string>();
    let backoff = 250;
    while (!signal.aborted) {
      const agent = await this.client.getAgent(sessionId, signal);
      const nextRun = agent?.latestRunId;
      if (!agent || !nextRun) {
        await cursorCloudDelay(400, signal);
        continue;
      }
      if (nextRun !== runId) {
        runId = nextRun;
        lastEventId = undefined;
      }
      const response = await this.client.openRunStream(sessionId, runId, lastEventId, signal);
      if (response.status === 410) {
        await response.body?.cancel().catch(() => {});
        yield* await this.#terminalRun(sessionId, runId, seen, signal);
        await this.#waitForNextRun(sessionId, runId, signal);
        backoff = 250;
        continue;
      }
      if (!response.ok || !response.body) {
        await response.text().catch(() => "");
        await response.body?.cancel().catch(() => {});
        if (response.status === 401) throw new CursorCloudRequestError(401, "unauthorized", "Cursor Cloud request failed (401 unauthorized)");
        if (response.status === 404) {
          await cursorCloudDelay(400, signal);
          continue;
        }
        await cursorCloudDelay(backoff, signal);
        backoff = Math.min(backoff * 2, 8_000);
        continue;
      }
      backoff = 250;
      let dropped = false;
      let sawDone = false;
      try {
        for await (const sse of readCursorSseEvents(response.body, signal)) {
          if (sse.id) lastEventId = sse.id;
          for (const event of this.#emit(sessionId, runId, sse, seen)) yield event;
          const data = sse.data && typeof sse.data === "object" ? sse.data as { code?: unknown } : undefined;
          if (sse.event === "error" && data?.code === "stream_unavailable") {
            dropped = true;
            break;
          }
          if (sse.event === "done") { sawDone = true; break; }
        }
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
        dropped = true;
      }
      if (dropped || !sawDone) {
        await cursorCloudDelay(backoff, signal);
        backoff = Math.min(backoff * 2, 8_000);
        continue;
      }
      await this.#waitForNextRun(sessionId, runId, signal);
    }
  }

  #emit(sessionId: string, turnId: string, sse: CursorCloudSseEvent, seen: Set<string>): OpenmaTaskEvent[] {
    const events: OpenmaTaskEvent[] = [];
    for (const event of this.#decode(sessionId, turnId, sse)) {
      if (!event.id || seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
    return events;
  }

  async #terminalRun(sessionId: string, runId: string, seen: Set<string>, signal: AbortSignal): Promise<OpenmaTaskEvent[]> {
    while (!signal.aborted) {
      const run = await this.client.getRun(sessionId, runId, signal);
      if (TERMINAL_RUN.has(run.status)) return this.#emit(sessionId, runId, runEvent(run), seen);
      await cursorCloudDelay(1_000, signal);
    }
    return [];
  }

  /** A finished run stays open until Cursor reports a different latest run. */
  async #waitForNextRun(sessionId: string, runId: string, signal: AbortSignal): Promise<void> {
    let wait = 1_000;
    while (!signal.aborted) {
      const agent = await this.client.getAgent(sessionId, signal);
      if (agent?.latestRunId && agent.latestRunId !== runId) return;
      await cursorCloudDelay(wait, signal);
      wait = Math.min(wait + 1_000, 5_000);
    }
  }
}

function conversationEvent(index: number, message: { type: string; text?: string }): CursorCloudSseEvent | null {
  const id = `v0:${index}:${message.type}`;
  if (message.type === "user_message") {
    return { event: "interaction_update", id, data: { type: "user-message-appended", userMessage: { type: "user_message", text: message.text ?? "" } } };
  }
  if (message.type === "assistant_message") return { event: "assistant", id, data: { text: message.text ?? "" } };
  return null;
}

function runEvent(run: CursorRunRecord): CursorCloudSseEvent {
  if (TERMINAL_RUN.has(run.status)) {
    return {
      event: "result",
      id: `run:${run.id}`,
      data: {
        runId: run.id,
        status: run.status,
        ...(run.result !== undefined ? { text: run.result } : {}),
        ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
        ...(run.git ? { git: run.git } : {}),
      },
    };
  }
  return { event: "status", data: { runId: run.id, status: run.status || "CREATING" } };
}
