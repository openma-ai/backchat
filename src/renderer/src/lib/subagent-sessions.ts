/** Current Active ACP Subagent Sessions RFD. Association and work state are
 * separate: nullable patches clear metadata, idle never destroys identity. */
export interface SubagentAssociation {
  sessionId: string;
  parentSessionId: string;
  title?: string | null;
  description?: string | null;
  capabilities?: Record<string, unknown> | null;
  state?: Record<string, unknown> | null;
  _meta?: Record<string, unknown> | null;
}
export interface SessionMessage {
  messageId: string;
  senderSessionId?: string;
  recipientSessionId?: string;
  content?: unknown[] | null;
  _meta?: unknown;
}
export function wireRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function wireSessionId(event: unknown): string | undefined {
  const row = wireRecord(event);
  const context = wireRecord(row["_openma.acp.notification"]);
  return typeof context.session_id === "string" ? context.session_id
    : row.update && typeof row.sessionId === "string" ? row.sessionId : undefined;
}
export function patchAssociation(old: SubagentAssociation | undefined, parentSessionId: string, update: Record<string, unknown>): SubagentAssociation | undefined {
  if (typeof update.sessionId !== "string" || update.sessionId === parentSessionId) return undefined;
  if (old && old.parentSessionId !== parentSessionId) return undefined;
  const result = { ...old, sessionId: update.sessionId, parentSessionId };
  for (const key of ["title", "description", "capabilities", "state", "_meta"] as const) {
    if (Object.hasOwn(update, key)) Object.assign(result, { [key]: update[key] });
  }
  return result;
}
export function patchSessionMessage(old: SessionMessage | undefined, update: Record<string, unknown>): SessionMessage | undefined {
  if (typeof update.messageId !== "string") return undefined;
  const result: SessionMessage = { ...old, messageId: update.messageId };
  for (const key of ["senderSessionId", "recipientSessionId"] as const) {
    if (typeof update[key] === "string") result[key] = update[key];
  }
  if (update.sessionUpdate === "session_message_chunk") {
    result.content = [...(result.content ?? []), update.content];
  } else {
    if (Object.hasOwn(update, "content")) result.content = update.content as unknown[] | null;
    if (Object.hasOwn(update, "_meta")) result._meta = update._meta;
  }
  return result;
}
