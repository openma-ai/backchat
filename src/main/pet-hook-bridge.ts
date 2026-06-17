import type { SessionEventOut } from "../shared/session-events.js";

export const PET_HOOK_ENDPOINT = "http://127.0.0.1:47632/hook";

export type PetHookEvent = {
  harness: "backchat";
  event: string;
  sessionId: string;
  turnId?: string;
  agentId?: string;
  label?: string;
};

export function petHookEventForSessionEvent(msg: SessionEventOut): PetHookEvent | null {
  if (msg.type === "session.ready") {
    return petHookEvent("session.started", msg.session_id, undefined, msg.agent_id);
  }
  if (msg.type === "session.complete") {
    return petHookEvent("session.completed", msg.session_id, msg.turn_id);
  }
  if (msg.type === "session.error") {
    return petHookEvent("session.failed", msg.session_id, msg.turn_id, undefined, msg.message);
  }
  if (msg.type !== "session.event") return null;
  return petHookEventForAcpEvent(msg.session_id, msg.turn_id, msg.event);
}

export function forwardSessionEventToPet(msg: SessionEventOut): void {
  const event = petHookEventForSessionEvent(msg);
  if (!event) return;
  void fetch(PET_HOOK_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => undefined);
}

function petHookEventForAcpEvent(sessionId: string, turnId: string, event: unknown): PetHookEvent | null {
  if (!isRecord(event)) return null;
  const update = readString(event, "sessionUpdate") ?? readString(event, "type");
  if (update === "requestPermission") {
    return petHookEvent("permission.requested", sessionId, turnId, undefined, readString(event, "title"));
  }
  if (update === "tool_call" || update === "tool_call_update") {
    const status = readString(event, "status");
    const title = readString(event, "title");
    if (status === "completed") return petHookEvent("task.completed", sessionId, turnId, undefined, title);
    if (status === "failed") return petHookEvent("session.failed", sessionId, turnId, undefined, title);
    return petHookEvent(`tool.${toolKind(readString(event, "kind"))}`, sessionId, turnId, undefined, title);
  }
  if (update === "plan" || update === "agent_thought_chunk") {
    return petHookEvent("review.started", sessionId, turnId);
  }
  return null;
}

function petHookEvent(
  event: string,
  sessionId: string,
  turnId?: string,
  agentId?: string,
  label?: string,
): PetHookEvent {
  const hook: PetHookEvent = {
    harness: "backchat",
    event,
    sessionId,
  };
  if (turnId) hook.turnId = turnId;
  if (agentId) hook.agentId = agentId;
  if (label) hook.label = label;
  return hook;
}

function toolKind(kind: string | undefined): "read" | "edit" | "run" | "search" | "fetch" {
  switch (kind) {
    case "read":
      return "read";
    case "edit":
    case "delete":
    case "move":
      return "edit";
    case "search":
      return "search";
    case "fetch":
      return "fetch";
    default:
      return "run";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
