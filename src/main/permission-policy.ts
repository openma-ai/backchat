export type SessionPermissionPolicy = "ask" | "auto-read" | "auto-all";

const policies = new Map<string, SessionPermissionPolicy>();
const READ_ONLY_KINDS = new Set(["read", "search", "think"]);

export function setRuntimePermissionPolicy(
  sessionId: string,
  policy: SessionPermissionPolicy,
): void {
  policies.set(sessionId, policy);
}

export function runtimePermissionPolicy(sessionId: string): SessionPermissionPolicy {
  return policies.get(sessionId) ?? "ask";
}

export function isSessionPermissionPolicy(value: unknown): value is SessionPermissionPolicy {
  return value === "ask" || value === "auto-read" || value === "auto-all";
}

/** Read-only ACP tool kinds. Unknown kinds stay pending. */
export function isReadOnlyToolCall(toolCall: unknown): boolean {
  if (!toolCall || typeof toolCall !== "object") return false;
  const kind = (toolCall as { kind?: unknown }).kind;
  return typeof kind === "string" && READ_ONLY_KINDS.has(kind);
}

export function firstAllowOption<T extends { optionId: string; kind: string }>(
  options: readonly T[],
): T | undefined {
  return options.find((option) => option.kind === "allow_once" || option.kind === "allow_always");
}
