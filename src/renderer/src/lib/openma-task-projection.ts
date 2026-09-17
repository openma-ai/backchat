import { replayAgentUIEvents } from "@openma/common/agent-ui";
import type { OpenMAEvent } from "@openma/common/session-events/openma";
import type { OpenmaTaskEvent, OpenmaTaskSnapshot } from "@shared/openma";
import type { SessionRow, Turn } from "./session-types";
import { openmaPendingActions, openmaRuntimePermission } from "@shared/openma-actions";
import type { BrokerAsk } from "./session-types";

export function openmaText(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((block) => block?.type === "text" ? String(block.text ?? "") : block?.type === "thinking" ? String(block.thinking ?? "") : "").join("") : "";
}
function operationId(event: OpenmaTaskEvent): string | undefined {
  const id = (event.metadata as Record<string, unknown> | undefined)?.["backchat.operation_id"];
  return typeof id === "string" ? id : undefined;
}
function eventTime(event: OpenmaTaskEvent, fallback: number): number {
  const value = Date.parse(String(event.processed_at ?? event.created_at ?? ""));
  return Number.isFinite(value) ? value : fallback;
}

/** OpenMA v1 owns remote status. This view never starts local ACP sessions
 * or infers completion from a disconnected stream. */
export function projectOpenmaTask(snapshot: OpenmaTaskSnapshot): { row: SessionRow; turns: Turn[] } {
  if (snapshot.task.provider) return projectDirectTask(snapshot);
  const { task } = snapshot;
  const turns: Turn[] = [];
  const messageKeys = new Map<Turn, { text?: unknown; thought?: unknown }>();
  let current: Turn | undefined;
  const seenOperations = new Set<string>();
  const committed = new Set(snapshot.events.filter((e) => e.type === "agent.message" || e.type === "agent.thinking").map((e) => e.message_id ?? e.thinking_id).filter(Boolean));
  const createTurn = (key: string, prompt: string, time: number): Turn => {
    const turn: Turn = { id: `${task.id}:${key}`, sessionId: task.id, promptText: prompt, events: [], assistantText: "", thoughtText: "", status: "running", startedAt: time };
    turns.push(turn); return turn;
  };
  for (const event of snapshot.events) {
    const time = eventTime(event, task.createdAt);
    if (event.type === "user.message") {
      const op = operationId(event); if (op) seenOperations.add(op);
      if (current && current.status === "running") current.status = "unknown";
      current = createTurn(op ?? event.id ?? String(event.seq), openmaText(event.content), time);
      continue;
    }
    if (event.type === "session.status_idle" || event.type === "session.status_terminated") {
      if (current) {
        const reason = event.stop_reason as { type?: string } | undefined;
        if (reason?.type !== "requires_action") {
          current.status = event.type === "session.status_terminated" ? "cancelled" : "complete";
          current.stopReason = reason?.type; current.endedAt = time;
        }
      }
      continue;
    }
    let payload: unknown;
    let text = "";
    let kind: "text" | "thought" | undefined;
    if (event.type === "agent.message" || event.type === "agent.thinking") {
      kind = event.type === "agent.message" ? "text" : "thought";
      text = openmaText(event.content ?? event.thinking);
    } else if (event.type === "agent.message_chunk" || event.type === "agent.thinking_chunk") {
      if (committed.has(event.message_id ?? event.thinking_id)) continue;
      kind = event.type === "agent.message_chunk" ? "text" : "thought";
      text = typeof event.delta === "string" ? event.delta : "";
    } else if (["agent.tool_use", "agent.custom_tool_use", "agent.mcp_tool_use"].includes(event.type)) {
      payload = { sessionUpdate: "tool_call", toolCallId: event.id, title: event.name ?? "Tool", rawInput: event.input, status: "in_progress" };
    } else if (["agent.tool_result", "user.custom_tool_result", "agent.mcp_tool_result"].includes(event.type)) {
      payload = { sessionUpdate: "tool_call_update", toolCallId: event.tool_use_id ?? event.custom_tool_use_id, status: event.is_error ? "failed" : "completed", rawOutput: openmaText(event.content) };
    }
    if (kind && text) {
      current ??= createTurn("history", "", time);
      const messageId = event.message_id ?? event.thinking_id ?? event.id;
      const previous = messageKeys.get(current) ?? {};
      const body = kind === "text" ? current.assistantText : current.thoughtText;
      if (body && previous[kind] !== messageId) text = `\n\n${text}`;
      previous[kind] = messageId;
      messageKeys.set(current, previous);
      payload = { type: kind, text, messageId };
    }
    if (!payload) continue;
    current ??= createTurn("history", "", time);
    current.events.push({ payload, receivedAt: time });
    if (kind === "text") current.assistantText += text;
    if (kind === "thought") current.thoughtText += text;
  }
  if (current && (task.status === "running" || task.status === "rescheduling")) current.status = "running";
  const active = turns.findLast((turn) => turn.status === "running");
  const replied = new Set(snapshot.operations.filter((op) => op.id.startsWith("response:")).map((op) => op.id.slice("response:".length)));
  const pendingAsks: BrokerAsk[] = openmaPendingActions(snapshot.events).filter((action) => !replied.has(action.id)).map((action): BrokerAsk => {
    const permission = openmaRuntimePermission(action.event, task.id);
    if (permission) return { kind: "permission", ask: permission, openmaResponse: "runtime_permission" };
    return action.type === "confirmation" ? {
    kind: "permission", ask: { requestId: action.id, sessionId: task.id, toolCall: action.event,
      presentation: { title: String(action.event.name ?? "Tool approval"), reason: JSON.stringify(action.event.input ?? {}) },
      options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }, { optionId: "deny", name: "Deny", kind: "reject_once" }],
    },
  } : { kind: "elicitation", ask: { requestId: action.id, sessionId: task.id, mode: "form", message: String(action.event.name ?? "Requested result"), fields: [{ type: "text", name: "result", title: "Reply", description: JSON.stringify(action.event.input ?? {}), required: true }] } };
  });
  for (const operation of snapshot.operations) {
    if (operation.event.type !== "user.message" || seenOperations.has(operation.id)) continue;
    const turn = createTurn(operation.id, openmaText(operation.event.content), operation.createdAt);
    turn.status = operation.state === "uncertain" ? "unknown" : "queued";
    if (operation.state === "uncertain") turn.errorMessage = "Delivery is unconfirmed. History will reconcile this message without resending it.";
  }
  for (const frame of snapshot.events) {
    if (frame.type !== "system.user_message_pending") continue;
    const event = frame.event as OpenmaTaskEvent | undefined;
    if (event?.type !== "user.message") continue;
    const key = operationId(event) ?? event.id ?? String(frame.event_id);
    if (turns.some((turn) => turn.id === `${task.id}:${key}`)) continue;
    const turn = createTurn(key, openmaText(event.content), Number(frame.enqueued_at) || task.updatedAt);
    turn.status = "queued";
  }
  return { row: {
    id: task.id, agent_id: task.target.agentId, cwd: "", acp_session_id: "", label: task.title,
    createdAt: task.createdAt, status: task.status === "terminated" ? "disposed" : task.status === "idle" ? "ready" : "running",
    openma: task, executionTarget: task.target, remoteConnection: snapshot.connection, remoteError: snapshot.error,
    pinnedAt: task.pinnedAt ?? undefined, archivedAt: task.archivedAt ?? undefined,
    activeTurnId: active?.id,
    pendingAsks,
  }, turns };
}


function projectDirectTask(snapshot: OpenmaTaskSnapshot): { row: SessionRow; turns: Turn[] } {
  const canonical = snapshot.events.flatMap(event => event.canonical ? [event.canonical as OpenMAEvent] : []);
  // Informational provider frames remain in the stored log, but must not split
  // a streamed message before its authoritative full-text replacement arrives.
  const transcript = canonical.filter(event => event.type !== "vendor.event" && event.type !== "raw.event");
  const state = replayAgentUIEvents(snapshot.task.sessionId, transcript);
  const turns: Turn[] = state.turnOrder.map(id => {
    const source = state.turns[id]!;
    const startedAt = Date.parse(source.startedAt ?? "") || snapshot.task.createdAt;
    const turn: Turn = { id: `${snapshot.task.id}:${id}`, sessionId: snapshot.task.id, promptText: "", assistantText: "", thoughtText: "", events: [],
      status: source.status === "completed" ? "complete" : source.status === "failed" ? "error" : source.status,
      startedAt, errorMessage: source.error, stopReason: source.reason, endedAt: source.endedAt ? Date.parse(source.endedAt) : undefined };
    for (const item of source.items) {
      if (item.kind === "tool") {
        turn.events.push({ receivedAt: startedAt, payload: { sessionUpdate: "tool_call", toolCallId: item.id, title: item.title ?? item.name ?? "Tool", rawInput: item.rawInput, rawOutput: item.rawOutput, status: item.status } });
      } else if (!("text" in item)) {
        // Raw/vendor records stay in the canonical log; they are not assistant prose.
        continue;
      } else if (item.role === "user") {
        turn.promptText += `${turn.promptText ? "\n" : ""}${item.text}`;
      } else {
        const kind = item.kind === "thinking" ? "thought" : "text";
        if (kind === "text") turn.assistantText += item.text; else turn.thoughtText += item.text;
        turn.events.push({ receivedAt: startedAt, payload: { type: kind, text: item.text, messageId: item.id } });
      }
    }
    return turn;
  });
  // Reuse the task shell and pending-input presentation; wire records are retained
  // for provider-specific tool replies, while all transcript content comes from common.
  const shell = projectOpenmaTask({ ...snapshot, task: { ...snapshot.task, provider: undefined }, operations: snapshot.operations.filter(op => op.event.type !== "user.message"),
    events: snapshot.events.flatMap(e => e.pendingActions ? [e] : e.wire ? [e.wire as OpenmaTaskEvent] : e.canonical ? [] : [e]) });
  for (const op of snapshot.operations) {
    if (op.event.type !== "user.message" || op.state === "accepted") continue;
    turns.push({ id: `${snapshot.task.id}:${op.id}`, sessionId: snapshot.task.id, promptText: openmaText(op.event.content), assistantText: "", thoughtText: "", events: [], startedAt: op.createdAt,
      status: op.state === "pending" ? "queued" : "unknown", errorMessage: op.state === "uncertain" ? "Delivery is unconfirmed. Check remote history before resending." : undefined });
  }
  shell.row.openma = snapshot.task;
  shell.row.activeTurnId = turns.findLast(t => t.status === "running")?.id;
  return { row: shell.row, turns };
}
