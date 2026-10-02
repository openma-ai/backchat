export type SessionPermissionPolicy = "ask" | "auto-read" | "auto-all";

const policies = new Map<string, SessionPermissionPolicy>();
const approvedTools = new Map<string, Set<string>>();
const READ_ONLY_KINDS = new Set(["read", "search", "think"]);
const WRITE_HINT = /\b(edit|write|delete|move|remove|shell|bash|exec|execute|apply_patch|strreplace|notebook)\b/i;

export function setRuntimePermissionPolicy(
  sessionId: string,
  policy: SessionPermissionPolicy,
): void {
  policies.set(sessionId, policy);
}

/** Undefined means the session never set a CLI policy. GUI writes inside the
 *  workspace stay silent in that case. Explicit ask and auto-read do not. */
export function runtimePermissionPolicy(sessionId: string): SessionPermissionPolicy | undefined {
  return policies.get(sessionId);
}

export function isSessionPermissionPolicy(value: unknown): value is SessionPermissionPolicy {
  return value === "ask" || value === "auto-read" || value === "auto-all";
}

/** Read-only ACP tool kinds. Unknown kinds, and any edit/write/delete/move
 *  hint in the title or name, stay pending. */
export function isReadOnlyToolCall(toolCall: unknown): boolean {
  if (!toolCall || typeof toolCall !== "object") return false;
  const record = toolCall as {
    kind?: unknown;
    title?: unknown;
    name?: unknown;
    toolName?: unknown;
    tool_name?: unknown;
  };
  const label = [record.title, record.name, record.toolName, record.tool_name]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (WRITE_HINT.test(label)) return false;
  const kind = typeof record.kind === "string" ? record.kind.toLowerCase() : "";
  return READ_ONLY_KINDS.has(kind);
}

export function noteToolApproval(sessionId: string, toolCallId: string | undefined): void {
  if (!toolCallId) return;
  const approved = approvedTools.get(sessionId) ?? new Set<string>();
  approved.add(toolCallId);
  approvedTools.set(sessionId, approved);
}

export function toolWasApproved(sessionId: string, toolCallId: string): boolean {
  return approvedTools.get(sessionId)?.has(toolCallId) ?? false;
}

export function toolCallIdOf(toolCall: unknown): string | undefined {
  if (!toolCall || typeof toolCall !== "object") return undefined;
  const record = toolCall as { toolCallId?: unknown; tool_call_id?: unknown; id?: unknown };
  const id = record.toolCallId ?? record.tool_call_id ?? record.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

export function firstAllowOption<T extends { optionId: string; kind: string }>(
  options: readonly T[],
): T | undefined {
  return options.find((option) => option.kind === "allow_once" || option.kind === "allow_always");
}
