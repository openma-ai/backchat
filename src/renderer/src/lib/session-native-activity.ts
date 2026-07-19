import type {
  NativeAgentProvider,
  NativeAgentUpdate,
} from "./native-agent-events";
import type { SessionRow, SubagentActivity, Turn } from "./session-types";

export function nativeActivitySessionStatus(
  status: SubagentActivity["status"],
): SessionRow["status"] {
  if (status === "error") return "errored";
  if (status === "complete" || status === "cancelled") return "ready";
  return "running";
}
export function nativeActivityTurnStatus(
  status: SubagentActivity["status"],
): Turn["status"] {
  if (status === "complete") return "complete";
  if (status === "error") return "error";
  if (status === "cancelled") return "cancelled";
  return "running";
}

export function nativeChildThreadId(update: NativeAgentUpdate): string | undefined {
  if (!update.childId) return undefined;
  return update.toolCallId && update.childId === `${update.provider}:${update.toolCallId}`
    ? undefined
    : update.childId;
}

export function appendUnique(
  values: string[] | undefined,
  value: string | undefined,
): string[] | undefined {
  if (!value) return values;
  const next = values ? [...values] : [];
  if (!next.includes(value)) next.push(value);
  return next;
}

export function nativeProviderForAgent(agentId: string | undefined): NativeAgentProvider | undefined {
  const normalized = (agentId ?? "").toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "codex-acp" || normalized.includes("codex")) return "codex";
  if (
    normalized === "claude-acp" ||
    normalized.includes("claude-code") ||
    normalized.includes("claude") ||
    normalized === "cc" ||
    normalized.startsWith("cc-")
  ) {
    return "claude";
  }
  return undefined;
}
