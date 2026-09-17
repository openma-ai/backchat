import type { OpenmaTaskEvent } from "./openma";
import type { PermissionAskInfo } from "./api";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Normalize the runtime callback contract before the GUI renders an ask. */
export function openmaRuntimePermission(event: OpenmaTaskEvent, sessionId: string): PermissionAskInfo | null {
  const action = record(record(event.input)._openma);
  if (event.type !== "agent.custom_tool_use" || !event.id || action.type !== "runtime_action" || action.method !== "session/request_permission") return null;
  const params = record(action.params);
  const toolCall = record(params.toolCall);
  if (!Array.isArray(params.options) || !params.options.length) return null;
  const options: PermissionAskInfo["options"] = [];
  for (const value of params.options) {
    const option = record(value);
    if (typeof option.optionId !== "string" || !option.optionId || typeof option.name !== "string" || !["allow_once", "allow_always", "reject_once", "reject_always"].includes(String(option.kind))) return null;
    options.push({ optionId: option.optionId, name: option.name, kind: option.kind as PermissionAskInfo["options"][number]["kind"] });
  }
  return { requestId: event.id, sessionId, toolCall: params.toolCall, options,
    presentation: { title: typeof toolCall.title === "string" ? toolCall.title : String(event.name ?? "Runner permission"), ...(typeof toolCall.kind === "string" ? { kind: toolCall.kind } : {}) },
  };
}
export interface OpenmaPendingAction { id: string; type: "confirmation" | "custom_result"; event: OpenmaTaskEvent }
export function openmaPendingActions(events: OpenmaTaskEvent[]): OpenmaPendingAction[] {
  const direct = events.findLast(event => Array.isArray(event.pendingActions));
  if (direct) return direct.pendingActions as OpenmaPendingAction[];
  const tools = new Map<string, OpenmaTaskEvent>();
  const requested = new Map<string, string[]>();
  const resolved = new Set<string>();
  for (const event of events) {
    if (event.id && ["agent.tool_use", "agent.mcp_tool_use", "agent.custom_tool_use"].includes(event.type)) tools.set(event.id, event);
    const thread = String(event.session_thread_id ?? "main");
    if (event.type === "session.status_running" || event.type === "session.status_terminated") requested.delete(thread);
    if (event.type === "session.status_idle") {
      const reason = event.stop_reason as { type?: string; event_ids?: string[] } | undefined;
      requested.set(thread, reason?.type === "requires_action" && Array.isArray(reason.event_ids) ? reason.event_ids : []);
    }
    if (["user.tool_confirmation", "agent.tool_result", "agent.mcp_tool_result"].includes(event.type) && typeof event.tool_use_id === "string") resolved.add(event.tool_use_id);
    if (event.type === "user.custom_tool_result" && typeof event.custom_tool_use_id === "string") resolved.add(event.custom_tool_use_id);
  }
  return [...new Set([...requested.values()].flat())].flatMap((id) => {
    const event = tools.get(id);
    return event && !resolved.has(id) ? [{ id, type: event.type === "agent.custom_tool_use" ? "custom_result" as const : "confirmation" as const, event }] : [];
  });
}
