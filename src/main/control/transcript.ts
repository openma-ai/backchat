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
  return events;
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
    return { cursor, role: "system", type: "status", timestamp, status: "cancelled", text: "cancelled" };
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
  if (kind === "tool.call" || kind === "tool.called" || kind === "tool.start") {
    return {
      cursor,
      role: "tool",
      type: "tool_call",
      timestamp,
      text,
      name: stringField(record(data).name) ?? stringField(record(data).title),
      tool_call_id: stringField(record(data).tool_call_id) ?? stringField(record(data).toolCallId),
      status: "start",
    };
  }
  if (kind === "tool.result" || kind === "tool.completed") {
    return {
      cursor,
      role: "tool",
      type: "tool_result",
      timestamp,
      text,
      tool_call_id: stringField(record(data).tool_call_id) ?? stringField(record(data).toolCallId),
      status: stringField(record(data).status) ?? "completed",
    };
  }
  if (kind.includes("permission")) {
    return {
      cursor,
      role: "system",
      type: "permission",
      timestamp,
      text,
      request_id: stringField(record(data).request_id) ?? stringField(record(data).requestId),
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
