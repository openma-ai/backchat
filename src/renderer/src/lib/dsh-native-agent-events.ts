import type { NativeAgentTranscriptUpdate, NativeAgentUpdate } from "./native-agent-events";
import { decodeNativeAgentTranscript } from "./native-agent-events";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function inner(event: unknown): Record<string, unknown> {
  const envelope = record(event);
  return envelope.update !== undefined ? record(envelope.update) : envelope;
}

/** DSH 0.4.39 SessionProjection emits these lifecycle records independently
 * of the subagent launch tool. Never infer a child from a tool's name/result. */
export function dshNativeAgentUpdates(event: unknown): NativeAgentUpdate[] {
  const update = inner(event);
  const dsh = record(record(update._meta).dsh);
  if (update.sessionUpdate !== "session_info_update" || dsh.event !== "subagent/lifecycle") return [];
  const child = record(dsh.subagent);
  const childId = text(child.childSessionId);
  const runId = text(child.runId);
  if (!childId || !runId || !text(child.provider)) return [];
  const identity = { provider: "dsh" as const, operation: "subagent_spawn" as const,
    toolCallId: `subagent:${runId}`, childId };
  if (child.state === "started") return [{ ...identity, status: "running" }];
  if (child.state !== "finished") return [];
  const reason = text(child.stopReason);
  return [{ ...identity, reason,
    status: reason === "completed" ? "complete"
      : reason === "error" ? "error"
      : reason === "aborted" ? "cancelled" : "unknown",
  }];
}

export function dshNativeAgentTranscript(event: unknown): NativeAgentTranscriptUpdate[] {
  const update = inner(event);
  const child = record(record(record(update._meta).dsh).subagent);
  const childId = text(child.childSessionId);
  const parentToolUseId = text(child.parentToolCallId);
  if (!childId || !parentToolUseId || !text(child.provider)) return [];
  const decoded = decodeNativeAgentTranscript(event, parentToolUseId, "dsh");
  return decoded.map((entry) => ({ ...entry, childId }));
}
