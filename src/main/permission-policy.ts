export type SessionPermissionPolicy = "ask" | "auto-read" | "auto-edit" | "auto-all";

const policies = new Map<string, SessionPermissionPolicy>();
const approvedTools = new Map<string, Set<string>>();
const permissionDecisions = new Map<string, PermissionDecision>();
const READ_ONLY_KINDS = new Set(["read", "search", "think"]);
const EDIT_KINDS = new Set(["edit", "write", "delete", "move"]);
const WRITE_HINT = /\b(edit|write|delete|move|remove|shell|bash|exec|execute|apply_patch|strreplace|notebook)\b/i;
const SHELL_HINT = /\b(shell|bash|exec|execute|terminal)\b/i;
const EDIT_HINT = /\b(edit|write|delete|move|apply_patch|strreplace)\b/i;

export interface PermissionDecision {
  outcome: string;
  optionKind?: string;
  optionId?: string;
}

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
  return value === "ask" || value === "auto-read" || value === "auto-edit" || value === "auto-all";
}

export function rememberPermissionDecision(
  sessionId: string,
  toolCallId: string | undefined,
  decision: PermissionDecision,
): void {
  if (!toolCallId) return;
  permissionDecisions.set(`${sessionId}\0${toolCallId}`, decision);
}

export function rememberedPermissionDecision(
  sessionId: string,
  toolCallId: string | undefined,
): PermissionDecision | undefined {
  if (!toolCallId) return undefined;
  return permissionDecisions.get(`${sessionId}\0${toolCallId}`);
}

/** Shell and execute stay pending under auto-edit. Edit and read do not. */
export function shouldAutoApproveTool(policy: SessionPermissionPolicy | undefined, toolCall: unknown): boolean {
  if (policy === "auto-all") return true;
  if (policy === "auto-read") return isReadOnlyToolCall(toolCall);
  if (policy === "auto-edit") return !isShellToolCall(toolCall) && (isReadOnlyToolCall(toolCall) || isEditToolCall(toolCall));
  return false;
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

export function isShellToolCall(toolCall: unknown): boolean {
  if (!toolCall || typeof toolCall !== "object") return false;
  const record = toolCall as {
    kind?: unknown;
    title?: unknown;
    name?: unknown;
    toolName?: unknown;
    tool_name?: unknown;
  };
  const kind = typeof record.kind === "string" ? record.kind.toLowerCase() : "";
  if (kind === "execute") return true;
  return SHELL_HINT.test(toolLabel(record));
}

export function isEditToolCall(toolCall: unknown): boolean {
  if (!toolCall || typeof toolCall !== "object" || isShellToolCall(toolCall)) return false;
  const record = toolCall as {
    kind?: unknown;
    title?: unknown;
    name?: unknown;
    toolName?: unknown;
    tool_name?: unknown;
  };
  const kind = typeof record.kind === "string" ? record.kind.toLowerCase() : "";
  if (EDIT_KINDS.has(kind)) return true;
  return EDIT_HINT.test(toolLabel(record));
}

function toolLabel(record: {
  title?: unknown;
  name?: unknown;
  toolName?: unknown;
  tool_name?: unknown;
}): string {
  return [record.title, record.name, record.toolName, record.tool_name]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
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
