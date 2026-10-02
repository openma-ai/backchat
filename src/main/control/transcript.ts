import type { TranscriptEvent } from "../../shared/control-protocol.js";
import { toolCallOutcome, type ToolCallOutcome } from "../../shared/tool-outcome.js";
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
  const permissions = permissionOutcomes(rows);
  const events: TranscriptEvent[] = [];
  for (const row of rows) {
    if (sinceSeq !== undefined && row.seq <= sinceSeq) continue;
    if (row.type === "user_prompt") {
      const text = textOf(parseData(row.data));
      if (text && userMessages.has(text)) continue;
    }
    const mapped = mapRow(row, permissions);
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

function permissionOutcomes(rows: readonly PersistedEvent[]): Map<string, {
  outcome?: string;
  optionKind?: string;
  optionId?: string;
}> {
  const byRequest = new Map<string, string>();
  const byTool = new Map<string, { outcome?: string; optionKind?: string; optionId?: string }>();
  for (const row of rows) {
    const fields = record(parseData(row.data));
    const requestId = stringField(fields.request_id);
    const toolCallId = stringField(fields.tool_call_id) ?? stringField(fields.toolCallId);
    if (row.type === "permission_request" && requestId && toolCallId) {
      byRequest.set(requestId, toolCallId);
    }
    if (row.type !== "permission_response") continue;
    const id = toolCallId ?? (requestId ? byRequest.get(requestId) : undefined);
    if (!id) continue;
    byTool.set(id, {
      outcome: stringField(fields.outcome),
      optionKind: stringField(fields.option_kind),
      optionId: stringField(fields.option_id),
    });
  }
  return byTool;
}

function mapRow(
  row: PersistedEvent,
  permissions: Map<string, { outcome?: string; optionKind?: string; optionId?: string }>,
): TranscriptEvent | null {
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
      tool_call_id: stringField(fields.tool_call_id) ?? stringField(fields.toolCallId),
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
    const toolCallId = stringField(fields.tool_call_id) ?? stringField(fields.toolCallId);
    return {
      cursor,
      role: "tool",
      type: "tool_result",
      timestamp,
      text,
      name: stringField(fields.tool_name) ?? stringField(fields.name) ?? stringField(fields.title),
      tool_call_id: toolCallId,
      status: toolResultStatus(kind, fields, toolCallId ? permissions.get(toolCallId) : undefined),
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

function toolResultStatus(
  kind: string,
  fields: Record<string, unknown>,
  permission: { outcome?: string; optionKind?: string; optionId?: string } | undefined,
): string {
  if (kind === "tool.cancelled") return "cancelled";
  const recorded = stringField(fields.outcome);
  if (recorded === "denied" || permissionDenies(permission)) return "denied";
  if (kind === "tool.failed" || recorded === "failed") return "failed";
  const derived = (recorded as ToolCallOutcome | undefined) ?? toolCallOutcome({
    status: kind === "tool.completed" ? stringField(fields.status) ?? "completed" : stringField(fields.status),
    rawOutput: fields.raw_output ?? fields.rawOutput ?? fields.text,
    content: fields.content,
    error: fields.error,
    permission_outcome: permission?.outcome,
    option_kind: permission?.optionKind,
    option_id: permission?.optionId,
  });
  if (derived === "ok") return "completed";
  if (derived === "denied") return "denied";
  if (derived === "failed") return "failed";
  if (derived === "cancelled") return "cancelled";
  if (derived === "finished") return "finished";
  if (kind === "tool.result" && (textOf(fields) || stringField(fields.error))) return "completed";
  return "finished";
}

function permissionDenies(permission: { outcome?: string; optionKind?: string; optionId?: string } | undefined): boolean {
  if (!permission) return false;
  const outcome = permission.outcome?.toLowerCase();
  if (outcome === "cancelled" || outcome === "rejected" || outcome === "denied") return true;
  const kind = permission.optionKind?.toLowerCase();
  if (kind === "reject_once" || kind === "reject_always") return true;
  const optionId = permission.optionId?.toLowerCase();
  return optionId === "reject" || optionId === "reject-once" || optionId === "reject_once";
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
