import type { TranscriptEvent } from "../../shared/control-protocol.js";
import type { PersistedEvent } from "../sql-store.js";

/** Stable, pollable transcript. `cursor` is the SQLite event seq. */
export function transcriptFromHistory(
  rows: readonly PersistedEvent[],
  since?: string,
): TranscriptEvent[] {
  const sinceSeq = since === undefined || since === "" ? undefined : Number(since);
  if (sinceSeq !== undefined && !Number.isSafeInteger(sinceSeq)) {
    throw new Error(`Invalid transcript cursor: ${since}`);
  }
  const userMessages = new Set<string>();
  for (const row of rows) {
    if (row.type !== "openma_event") continue;
    const parsed = parseData(row.data);
    if (parsed?.type === "user.message" && typeof textOf(parsed.data) === "string") {
      userMessages.add(textOf(parsed.data)!);
    }
  }
  const events: TranscriptEvent[] = [];
  for (const row of rows) {
    if (sinceSeq !== undefined && row.seq <= sinceSeq) continue;
    if (row.type === "user_prompt") {
      const text = textOf(parseData(row.data));
      if (text && userMessages.has(text)) continue;
    }
    const mapped = mapRow(row);
    if (mapped) events.push(mapped);
  }
  return mergeAdjacentText(events);
}

export function sessionTurnSummary(rows: readonly PersistedEvent[]): {
  outcome: "idle" | "running" | "complete" | "error" | "cancelled";
  reply?: string;
} {
  let outcome: "idle" | "complete" | "error" | "cancelled" = "idle";
  let reply = "";
  let turnId: string | undefined;
  for (const row of rows) {
    const parsed = parseData(row.data);
    const nextTurn = stringField(parsed?.turn_id) ?? stringField(record(parsed?.data).turn_id);
    if (nextTurn && nextTurn !== turnId) {
      turnId = nextTurn;
      reply = "";
      outcome = "idle";
    }
    if (row.type === "turn_cancelled") outcome = "cancelled";
    if (!parsed) continue;
    const kind = row.type === "openma_event" && typeof parsed.type === "string" ? parsed.type : "";
    const text = textOf(parsed.data);
    if (kind === "agent.message" || kind === "agent.message_chunk") {
      if (text) reply += text;
    }
    if (kind === "turn.completed") outcome = "complete";
    if (kind === "turn.failed" || kind === "session.error") outcome = "error";
    if (kind === "turn.cancelled" || kind === "turn.interrupted") outcome = "cancelled";
  }
  const trimmed = reply.trim();
  return { outcome, ...(trimmed ? { reply: trimmed } : {}) };
}

function mergeAdjacentText(events: TranscriptEvent[]): TranscriptEvent[] {
  const merged: TranscriptEvent[] = [];
  for (const event of events) {
    const previous = merged.at(-1);
    if (
      previous
      && previous.role === "assistant"
      && previous.type === "text"
      && event.role === "assistant"
      && event.type === "text"
    ) {
      previous.text = `${previous.text ?? ""}${event.text ?? ""}`;
      previous.cursor = event.cursor;
      previous.timestamp = event.timestamp;
      continue;
    }
    merged.push({ ...event });
  }
  return merged;
}

function mapRow(row: PersistedEvent): TranscriptEvent | null {
  const cursor = String(row.seq);
  const timestamp = new Date(row.ts).toISOString();
  const parsed = parseData(row.data);
  if (row.type === "user_prompt") {
    const text = textOf(parsed);
    return text ? { cursor, role: "user", type: "text", timestamp, text } : null;
  }
  if (row.type === "turn_cancelled") {
    return { cursor, role: "system", type: "status", timestamp, status: "cancelled", text: "turn cancelled" };
  }
  if (row.type === "permission_request" || row.type === "permission_response") {
    const fields = record(parsed);
    return {
      cursor,
      role: "system",
      type: "permission",
      timestamp,
      text: stringField(fields.title),
      request_id: stringField(fields.request_id),
      status: stringField(fields.outcome) ?? (row.type === "permission_request" ? "pending" : undefined),
      name: stringField(fields.option_id) ?? stringField(fields.kind),
    };
  }
  if (row.type !== "openma_event" || !parsed) return null;
  const kind = typeof parsed.type === "string" ? parsed.type : "";
  const data = parsed.data;
  const text = textOf(data);
  if (kind === "user.message") {
    return text ? { cursor, role: "user", type: "text", timestamp, text } : null;
  }
  if (kind === "agent.message" || kind === "agent.message_chunk") {
    return text ? { cursor, role: "assistant", type: "text", timestamp, text } : null;
  }
  if (kind === "agent.thinking" || kind === "agent.thought_chunk") {
    return text ? { cursor, role: "assistant", type: "thought", timestamp, text } : null;
  }
  if (kind === "tool.call" || kind === "tool.called" || kind === "tool.start" || kind === "tool.started") {
    const fields = record(data);
    return {
      cursor,
      role: "tool",
      type: "tool_call",
      timestamp,
      text: text ?? stringField(fields.title),
      name: stringField(fields.tool_name) ?? stringField(fields.name) ?? stringField(fields.title) ?? stringField(fields.kind),
      tool_call_id: stringField(fields.tool_call_id) ?? stringField(fields.toolCallId),
      status: "start",
    };
  }
  if (kind === "tool.result" || kind === "tool.completed" || kind === "tool.failed" || kind === "tool.cancelled") {
    const fields = record(data);
    return {
      cursor,
      role: "tool",
      type: "tool_result",
      timestamp,
      text,
      name: stringField(fields.tool_name) ?? stringField(fields.name) ?? stringField(fields.title),
      tool_call_id: stringField(fields.tool_call_id) ?? stringField(fields.toolCallId),
      status: kind === "tool.failed" ? "failed" : kind === "tool.cancelled" ? "cancelled" : stringField(fields.status) ?? "completed",
    };
  }
  if (kind === "turn.completed" || kind === "turn.failed" || kind === "turn.cancelled" || kind === "turn.interrupted") {
    const status = kind === "turn.completed"
      ? "complete"
      : kind === "turn.failed"
        ? "error"
        : "cancelled";
    return { cursor, role: "system", type: "status", timestamp, status, text: status === "complete" ? "turn complete" : status === "error" ? "turn failed" : "turn cancelled" };
  }
  if (kind.includes("permission")) {
    const fields = record(data);
    return {
      cursor,
      role: "system",
      type: "permission",
      timestamp,
      text,
      request_id: stringField(fields.request_id) ?? stringField(fields.requestId),
      status: stringField(fields.outcome) ?? stringField(fields.status),
      name: stringField(fields.option_id) ?? stringField(fields.optionId),
    };
  }
  if (!text) return null;
  return { cursor, role: "system", type: "status", timestamp, text, status: kind };
}

function parseData(data: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
