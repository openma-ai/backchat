import { toolCallOutcome } from "../../shared/tool-outcome.js";

export type ControlLiveEvent = {
  type: string;
  session_id?: string;
  timestamp?: string;
  [key: string]: unknown;
};

export class ControlStream {
  constructor(readonly events: AsyncIterable<ControlLiveEvent>) {}
}

const listeners = new Set<(event: ControlLiveEvent) => void>();

export function publishControlLiveEvent(event: ControlLiveEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeControlLiveEvents(
  listener: (event: ControlLiveEvent) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Map a main-process session event into the CLI NDJSON stream. */
export function streamEventsFromSession(event: {
  type: string;
  session_id?: string;
  turn_id?: string;
  message?: string;
  event?: unknown;
}): ControlLiveEvent[] {
  const timestamp = new Date().toISOString();
  const sessionId = event.session_id;
  if (!sessionId) return [];
  if (event.type === "session.complete") {
    return [{
      type: "result",
      session_id: sessionId,
      turn_id: event.turn_id,
      status: "complete",
      timestamp,
    }];
  }
  if (event.type === "session.error") {
    return [{
      type: "result",
      session_id: sessionId,
      turn_id: event.turn_id,
      status: "error",
      message: event.message,
      timestamp,
    }];
  }
  if (event.type === "session.cancel_requested") {
    return [{
      type: "result",
      session_id: sessionId,
      turn_id: event.turn_id,
      status: "cancelled",
      timestamp,
    }];
  }
  if (event.type !== "session.event") return [];
  const update = acpUpdate(event.event);
  if (!update) return [];
  const kind = update.sessionUpdate;
  if (kind === "agent_message_chunk") {
    const text = textContent(update.content);
    if (!text) return [];
    return [{
      type: "message_delta",
      session_id: sessionId,
      turn_id: event.turn_id,
      text,
      timestamp,
    }];
  }
  if (kind === "tool_call") {
    return [{
      type: "tool_call",
      session_id: sessionId,
      turn_id: event.turn_id,
      tool_call_id: stringField(update.toolCallId),
      title: stringField(update.title),
      kind: stringField(update.kind),
      status: "start",
      timestamp,
    }];
  }
  if (kind === "tool_call_update") {
    const status = stringField(update.status);
    if (status !== "completed" && status !== "failed" && status !== "cancelled") return [];
    return [{
      type: "tool_call",
      session_id: sessionId,
      turn_id: event.turn_id,
      tool_call_id: stringField(update.toolCallId),
      title: stringField(update.title),
      kind: stringField(update.kind),
      status: "end",
      outcome: toolCallOutcome(update) ?? "finished",
      timestamp,
    }];
  }
  return [];
}

function acpUpdate(event: unknown): Record<string, unknown> | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const nested = record.update;
  if (nested && typeof nested === "object" && typeof (nested as { sessionUpdate?: unknown }).sessionUpdate === "string") {
    return nested as Record<string, unknown>;
  }
  if (typeof record.sessionUpdate === "string") return record;
  return null;
}

function textContent(content: unknown): string | undefined {
  if (!content || typeof content !== "object") return undefined;
  const text = (content as { text?: unknown }).text;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
