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

/** Synthetic toolCallIds used until a parent Subagent tool can be correlated. */
export function isSyntheticSubagentToolCallId(toolCallId: string): boolean {
  return toolCallId.startsWith("rfd:") || toolCallId.startsWith("subagent:");
}

/** Live DSH settlement messages encode the parent tool id in messageId. */
export function toolCallIdFromSessionMessageId(messageId: string): string | undefined {
  const match = /^dsh:tool-result:(.+)$/.exec(messageId);
  return match?.[1] || undefined;
}

export function parentSubagentToolTask(rawInput: unknown): string | undefined {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return undefined;
  const input = rawInput as Record<string, unknown>;
  // Prefer prompt: DSH Subagent description is often a short label while
  // prompt carries the real delegated user message for the child bubble.
  for (const key of ["prompt", "description", "message", "task"] as const) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Parent-turn tools that launch a native/RFD child (DSH "Subagent", Codex spawn, …). */
export function isParentSubagentLaunchTool(tool: {
  title?: string | null;
  toolName?: string | null;
  rawInput?: unknown;
}): boolean {
  const title = (tool.title ?? "").trim().toLowerCase();
  const name = (tool.toolName ?? "").trim().toLowerCase();
  if (
    title === "subagent"
    || title.startsWith("start subagent")
    || /\bsubagent\b/.test(title)
    || title === "spawnagent"
    || title.startsWith("spawn agent")
  ) {
    return true;
  }
  if (
    name === "subagent"
    || name === "spawn_agent"
    || name === "spawnagent"
  ) {
    return true;
  }
  // DSH Subagent rawInput carries prompt/description; title is often exactly
  // "Subagent". Do not match bare Claude Task/Agent tools here — those have
  // their own native adapters with real toolCallIds.
  return title === "subagent" && parentSubagentToolTask(tool.rawInput) !== undefined;
}

export function sessionMessageText(content: unknown[] | null | undefined): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const row = block as Record<string, unknown>;
      return row.type === "text" && typeof row.text === "string" ? [row.text] : [];
    })
    .join("")
    .trim();
}
