import {
  createOpenMAEvent,
  createRawEvent as createCommonRawEvent,
  createVendorEvent as createCommonVendorEvent,
  type OpenMAEvent,
  type OpenMAEventSource,
} from "@openma/common/session-events/openma";
import { ACP_NOTIFICATION_CONTEXT_KEY } from "@openma/common/session-events/acp";
import { extractAcpSystemNotice } from "./acp-system-notices.js";

import type { SessionEventOut } from "./session-events.js";

export interface OpenMAEventBridgeOptions {
  occurredAt: string;
  harness?: string;
  adapter?: string;
}

/** Keep Backchat call sites on the shared constructors so raw/vendor records
 * use the same canonical `data` envelope as every other OpenMA consumer. */
function createRawEvent(
  input: Parameters<typeof createCommonRawEvent>[0],
): OpenMAEvent {
  return createCommonRawEvent(input);
}

function createVendorEvent(
  input: Parameters<typeof createCommonVendorEvent>[0],
): OpenMAEvent {
  return createCommonVendorEvent(input);
}

/**
 * Provider-neutral shape emitted by a per-harness runtime adapter.  The
 * concrete `NativeAgentUpdate` type lives in the renderer adapter layer; this
 * structural boundary keeps the shared event module usable from both main and
 * renderer without importing renderer code into main.
 */
export interface NativeAgentUpdateInput {
  provider: string;
  operation?: string;
  toolCallId?: string;
  childId?: string;
  task?: string;
  agentType?: string;
  nickname?: string;
  forkContext?: boolean;
  status?: "running" | "complete" | "error" | "cancelled" | string;
  result?: unknown;
  errorMessage?: string;
  reason?: string;
  closed?: boolean;
  childToolCallId?: string;
  childToolName?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
    totalTokens: number;
  };
  progress?: {
    kind: "subagent_progress" | "subagent_retry";
    elapsedTimeSeconds?: number;
    subagentType?: string;
    description?: string;
    lastToolName?: string;
    summary?: string;
    usage?: {
      totalTokens: number;
      toolUses: number;
      durationMs: number;
    };
    retry?: Record<string, unknown>;
  };
}

export interface NativeAgentTranscriptInput {
  provider: string;
  parentToolUseId: string;
  kind: "text" | "thought" | "content" | "tool" | "usage";
  text?: string;
  content?: unknown;
  contentChannel?: "message" | "thought";
  messageId?: string;
  toolCallId?: string;
  toolName?: string;
  usage?: NativeAgentUpdateInput["usage"];
  payload?: unknown;
}

export interface NativeAgentOpenMAEventContext {
  sessionId: string;
  turnId?: string;
  occurredAt: string;
  adapter?: string;
}

export interface NativeAgentReidentifiedInput {
  provider: string;
  previousChildId: string;
  childId: string;
  toolCallId?: string;
}

export interface RuntimeWorkItemUpdateInput {
  id: string;
  previousId?: string;
  toolCallId?: string;
  kind: "agent" | "bash" | "monitor" | "other";
  phase?: "lifecycle" | "progress" | "classification";
  status: "running" | "completed" | "failed" | "killed";
  title?: string;
  command?: string;
  canStop?: boolean;
  progress?: unknown;
  result?: unknown;
  error?: string;
  reason?: string;
}

export interface RuntimeMonitorEventInput {
  description: string;
  text: string;
  monitorId?: string;
}

export interface RuntimePlanUpdateInput {
  planId: string;
  updateMode: "replace" | "merge";
  entries: Array<{
    id?: string;
    content: string;
    status?: "pending" | "in_progress" | "completed" | "cancelled";
    priority?: "high" | "medium" | "low";
  }>;
}

function sourceFor(options: OpenMAEventBridgeOptions, harness = options.harness ?? "unknown"): OpenMAEventSource {
  return {
    kind: "harness",
    harness,
    adapter: options.adapter ?? "acp",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function eventType(value: unknown): string | undefined {
  const record = asRecord(value);
  const candidate = record?.sessionUpdate ?? record?.type ?? record?.event_type;
  return typeof candidate === "string" ? candidate : undefined;
}

function acpInner(value: unknown): Record<string, unknown> {
  const record = asRecord(value) ?? {};
  const update = asRecord(record.update);
  return update ?? record;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function acpText(inner: Record<string, unknown>): string | undefined {
  const content = asRecord(inner.content);
  return (
    stringValue(content?.text) ??
    stringValue(inner.text) ??
    stringValue(inner.delta) ??
    stringValue(inner.content)
  );
}

function claudeParentToolUseId(inner: Record<string, unknown>): string | undefined {
  const meta = asRecord(inner._meta);
  const claudeMeta = asRecord(meta?.claudeCode);
  return (
    stringValue(claudeMeta?.parentToolUseId) ??
    stringValue(inner.parentToolUseId) ??
    stringValue(inner.parent_tool_use_id)
  );
}

function codexMessagePhase(
  inner: Record<string, unknown>,
): "commentary" | "final_answer" | undefined {
  const codex = asRecord(asRecord(inner._meta)?.codex);
  return codex?.phase === "commentary" || codex?.phase === "final_answer"
    ? codex.phase
    : undefined;
}

function acpAdapterMeta(
  inner: Record<string, unknown>,
  rawEvent: unknown,
): Record<string, unknown> | undefined {
  const updateMeta = asRecord(inner._meta) ?? {};
  const raw = asRecord(rawEvent);
  const notificationContext =
    asRecord(inner[ACP_NOTIFICATION_CONTEXT_KEY])
    ?? asRecord(raw?.[ACP_NOTIFICATION_CONTEXT_KEY])
    ?? asRecord(inner["_openma.acp.notification"])
    ?? asRecord(raw?.["_openma.acp.notification"]);
  const notificationMeta = asRecord(notificationContext?.meta);
  const combined = {
    ...updateMeta,
    ...(notificationMeta ? { "acp.notification": notificationMeta } : {}),
  };
  return Object.keys(combined).length > 0 ? combined : undefined;
}

function canonicalToolLifecycle(
  inner: Record<string, unknown>,
  rawType: "tool_call" | "tool_call_update",
  adapterMeta?: Record<string, unknown>,
): { type: "tool.started" | "tool.progress" | "tool.completed" | "tool.failed"; data: Record<string, unknown> } | null {
  const toolCallId =
    stringValue(inner.toolCallId)
    ?? stringValue(inner.tool_call_id)
    ?? stringValue(inner.id);
  if (!toolCallId) return null;

  const meta = adapterMeta ?? asRecord(inner._meta) ?? {};
  const claudeMeta = asRecord(meta.claudeCode) ?? {};
  const terminalOutput = asRecord(meta.terminal_output);
  const terminalOutputDelta = asRecord(meta.terminal_output_delta);
  const mcpOutputDelta = asRecord(meta.mcp_output_delta);
  const terminalExit = asRecord(meta.terminal_exit);
  const terminalInfo = asRecord(meta.terminal_info);
  const explicitStatus = stringValue(inner.status)?.toLowerCase();
  const exitCode = terminalExit?.exit_code ?? terminalExit?.exitCode;
  const exitSignal = terminalExit?.signal;
  const derivedStatus =
    explicitStatus === "completed" || explicitStatus === "complete"
      ? "completed"
      : explicitStatus === "failed" || explicitStatus === "error"
        ? "failed"
        : explicitStatus === "pending" || explicitStatus === "in_progress"
          ? explicitStatus
          : typeof exitCode === "number"
            ? exitCode === 0 ? "completed" : "failed"
            : typeof exitSignal === "string" && exitSignal.length > 0
              ? "failed"
              : undefined;
  const type =
    derivedStatus === "completed"
      ? "tool.completed"
      : derivedStatus === "failed"
        ? "tool.failed"
        : rawType === "tool_call"
          ? "tool.started"
          : "tool.progress";

  const data: Record<string, unknown> = { tool_call_id: toolCallId };
  if (typeof inner.title === "string") data.title = inner.title;
  if (typeof inner.kind === "string") data.kind = inner.kind;
  if (derivedStatus) data.status = derivedStatus;
  const toolName =
    stringValue(claudeMeta.toolName)
    ?? stringValue(inner.toolName)
    ?? stringValue(inner.tool_name);
  if (toolName) data.tool_name = toolName;
  const nonExecutionKind = stringValue(claudeMeta.nonExecutionKind);
  const userFeedback = stringValue(claudeMeta.userFeedback);
  if (nonExecutionKind) data.reason = nonExecutionKind;
  if (userFeedback) data.error = userFeedback;
  if (inner.rawInput !== undefined) data.raw_input = inner.rawInput;
  else if (inner.raw_input !== undefined) data.raw_input = inner.raw_input;
  if (inner.rawOutput !== undefined) data.raw_output = inner.rawOutput;
  else if (inner.raw_output !== undefined) data.raw_output = inner.raw_output;
  if (Array.isArray(inner.content)) data.content = inner.content;
  if (Array.isArray(inner.locations)) data.locations = inner.locations;

  const terminalData =
    stringValue(terminalOutput?.data)
    ?? stringValue(terminalOutputDelta?.data);
  if (terminalData !== undefined) {
    data.output = {
      kind: "terminal",
      data: terminalData,
      ...(
        stringValue(terminalOutput?.terminal_id)
        ?? stringValue(terminalOutputDelta?.terminal_id)
          ? {
              terminal_id:
                stringValue(terminalOutput?.terminal_id)
                ?? stringValue(terminalOutputDelta?.terminal_id),
            }
          : {}
      ),
      append: true,
    };
  } else if (typeof mcpOutputDelta?.data === "string") {
    data.output = {
      kind: "mcp",
      data: mcpOutputDelta.data,
      append: true,
      separator: "\n",
    };
  }

  if (terminalExit || terminalInfo) {
    const terminalId =
      stringValue(terminalExit?.terminal_id)
      ?? stringValue(terminalInfo?.terminal_id);
    data.terminal = {
      ...(terminalId ? { terminal_id: terminalId } : {}),
      ...(terminalExit && ("exit_code" in terminalExit || "exitCode" in terminalExit)
        ? { exit_code: exitCode }
        : {}),
      ...(terminalExit && "signal" in terminalExit ? { signal: exitSignal } : {}),
    };
  }
  if (Object.keys(meta).length > 0) data.adapter_meta = meta;
  return { type, data };
}

function canonicalCodexSessionInfo(
  inner: Record<string, unknown>,
): { type: "session.running" | "session.idle" | "session.terminated" | "session.error" | "capability.updated"; data: Record<string, unknown> } | null {
  const codex = asRecord(asRecord(inner._meta)?.codex);
  if (!codex) return null;
  if (codex.closed === true) {
    return { type: "session.terminated", data: { reason: "provider_closed" } };
  }
  const error = asRecord(codex.error);
  if (error) {
    return error.willRetry === true
      ? {
          type: "session.running",
          data: { retrying: true, provider_error: error },
        }
      : {
          type: "session.error",
          data: {
            provider_error: error,
            ...(stringValue(error.message) ? { message: error.message } : {}),
          },
        };
  }
  const threadStatus = asRecord(codex.threadStatus);
  const statusType = stringValue(threadStatus?.type)?.toLowerCase();
  if (statusType === "active" || statusType === "running") {
    return { type: "session.running", data: { thread_status: threadStatus } };
  }
  if (statusType === "idle") {
    return { type: "session.idle", data: { thread_status: threadStatus } };
  }
  if (statusType?.includes("error")) {
    return {
      type: "session.error",
      data: { thread_status: threadStatus, message: statusType },
    };
  }
  if (typeof codex.archived === "boolean") {
    return {
      type: "capability.updated",
      data: { session_archived: codex.archived },
    };
  }
  return null;
}

function canonicalPiSessionInfo(
  inner: Record<string, unknown>,
): { type: "session.running" | "session.idle"; data: Record<string, unknown> } | null {
  const piAcp = asRecord(asRecord(inner._meta)?.piAcp);
  if (!piAcp || typeof piAcp.running !== "boolean") return null;
  const queueDepth = piAcp.queueDepth;
  return {
    type: piAcp.running ? "session.running" : "session.idle",
    data: {
      ...(typeof queueDepth === "number" && Number.isFinite(queueDepth)
        ? { queue_depth: queueDepth }
        : {}),
    },
  };
}

function callbackCategory(method: string):
  | "permission"
  | "filesystem"
  | "terminal"
  | "elicitation"
  | "mcp"
  | "extension" {
  if (method === "session/request_permission") return "permission";
  if (method.startsWith("fs/")) return "filesystem";
  if (method.startsWith("terminal/")) return "terminal";
  if (method.startsWith("elicitation/")) return "elicitation";
  if (method.startsWith("mcp/")) return "mcp";
  return "extension";
}

function acpRawRecord(
  payload: unknown,
  occurredAt: string,
  rawType?: string,
) {
  return {
    kind: "raw" as const,
    source: "acp" as const,
    method: "session/update",
    ...(rawType ? { event_type: rawType } : {}),
    payload,
    received_at: occurredAt,
    reason: "unknown" as const,
  };
}

function canonicalAcpUpdateEvent(
  message: Extract<SessionEventOut, { type: "session.event" }>,
  options: OpenMAEventBridgeOptions,
): OpenMAEvent | null {
  const inner = acpInner(message.event);
  const rawType = eventType(message.event);
  if (!rawType) return null;
  const raw = acpRawRecord(message.event, options.occurredAt, rawType);
  const parentId = claudeParentToolUseId(inner);
  const base = {
    event_id: transportEventId(`acp:${message.session_id}:${message.turn_id}`, message.event),
    session_id: message.session_id,
    turn_id: message.turn_id,
    source: sourceFor(options),
    occurred_at: options.occurredAt,
    ...(parentId ? { parent_id: parentId } : {}),
    raw,
  };
  const text = acpText(inner);
  const content = asRecord(inner.content);
  const messageId = stringValue(inner.messageId) ?? stringValue(inner.message_id);
  const adapterMeta = acpAdapterMeta(inner, message.event);
  const messagePhase = codexMessagePhase(inner);

  if (rawType === "agent_message_chunk") {
    const notice = extractAcpSystemNotice(message.event);
    if (notice) {
      return createOpenMAEvent({
        ...base,
        type: "system.notice",
        data: {
          message: notice.message,
          tone: notice.tone,
          ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
        },
      });
    }
  }

  if (
    rawType === "acp.client_request"
    || rawType === "acp.client_response"
    || rawType === "acp.client_error"
    || rawType === "acp.client_notification"
  ) {
    const method = stringValue(inner.method);
    if (!method) return null;
    const callbackId = stringValue(inner.requestId);
    if (rawType !== "acp.client_notification" && !callbackId) return null;
    const type = rawType === "acp.client_request"
      ? "callback.requested"
      : rawType === "acp.client_response"
        ? "callback.completed"
        : rawType === "acp.client_error"
          ? "callback.failed"
          : "callback.notification";
    return createOpenMAEvent({
      ...base,
      type,
      raw: {
        kind: "raw",
        source: "acp",
        method,
        event_type: rawType,
        payload: message.event,
        received_at: options.occurredAt,
        reason: "unknown",
      },
      data: {
        ...(callbackId ? { callback_id: callbackId } : {}),
        method,
        category: callbackCategory(method),
        ...(inner.params !== undefined ? { params: inner.params } : {}),
        ...(inner.result !== undefined ? { result: inner.result } : {}),
        ...(inner.error !== undefined ? { error: inner.error } : {}),
      },
    });
  }

  if (rawType === "acp.elicitation_complete") {
    const method = stringValue(inner.method);
    if (!method) return null;
    return createOpenMAEvent({
      ...base,
      type: "callback.notification",
      raw: {
        kind: "raw",
        source: "acp",
        method,
        event_type: rawType,
        payload: inner.params,
        received_at: options.occurredAt,
        reason: "unknown",
      },
      data: {
        method,
        category: "elicitation",
        ...(inner.params !== undefined ? { params: inner.params } : {}),
      },
    });
  }
  if (rawType === "acp.mcp_notification") {
    const method = stringValue(inner.method);
    if (!method) return null;
    return createRawEvent({
      event_id: base.event_id,
      session_id: base.session_id,
      turn_id: base.turn_id,
      source: base.source,
      occurred_at: base.occurred_at,
      source_kind: "acp",
      method,
      event_type: rawType,
      payload: inner.params,
      reason: "unsupported",
    });
  }

  if (
    rawType === "acp.extension_notification"
    || rawType === "acp.extension_request"
  ) {
    const method = stringValue(inner.method);
    if (!method) return null;
    const params = asRecord(inner.params);
    if (
      rawType === "acp.extension_request"
      && options.harness?.toLowerCase().includes("cursor")
      && method === "cursor/create_plan"
      && params
    ) {
      const planId = stringValue(params.toolCallId);
      const title = stringValue(params.name);
      const markdown = stringValue(params.plan);
      const entries = Array.isArray(params.todos)
        ? params.todos.flatMap((value) => {
            const todo = asRecord(value);
            const content = stringValue(todo?.content);
            if (!content) return [];
            const id = stringValue(todo?.id);
            const status = stringValue(todo?.status);
            return [{
              ...(id ? { id } : {}),
              content,
              ...(status ? { status } : {}),
            }];
          })
        : [];
      if (markdown || entries.length > 0) {
        return createOpenMAEvent({
          ...base,
          type: "plan.updated",
          data: markdown
            ? {
                representation: "markdown",
                ...(planId ? { plan_id: planId } : {}),
                document: {
                  ...(planId ? { id: planId } : {}),
                  ...(title ? { title } : {}),
                  markdown,
                },
                entries,
                adapter_meta: {
                  method,
                  ...(stringValue(params.overview)
                    ? { overview: params.overview }
                    : {}),
                  ...(typeof params.isProject === "boolean"
                    ? { isProject: params.isProject }
                    : {}),
                },
              }
            : {
                representation: "items",
                ...(planId ? { plan_id: planId } : {}),
                entries,
                adapter_meta: {
                  method,
                  ...(title ? { title } : {}),
                  ...(stringValue(params.overview)
                    ? { overview: params.overview }
                    : {}),
                  ...(typeof params.isProject === "boolean"
                    ? { isProject: params.isProject }
                    : {}),
                },
              },
        });
      }
    }
    if (
      rawType === "acp.extension_request"
      && options.harness?.toLowerCase().includes("cursor")
      && method === "cursor/update_todos"
      && Array.isArray(params?.todos)
    ) {
      const entries = params.todos.flatMap((value) => {
        const todo = asRecord(value);
        const content = stringValue(todo?.content);
        if (!content) return [];
            const id = stringValue(todo?.id);
            const status = stringValue(todo?.status);
            return [{
              ...(id ? { id } : {}),
              content,
              ...(status ? { status } : {}),
            }];
      });
      return createOpenMAEvent({
        ...base,
        type: "plan.updated",
        data: {
          representation: "items",
          plan_id: "cursor-todos",
          update_mode: params.merge === true ? "merge" : "replace",
          entries,
          adapter_meta: {
            method,
            ...(stringValue(params.toolCallId)
              ? { toolCallId: params.toolCallId }
              : {}),
            ...(typeof params.merge === "boolean" ? { merge: params.merge } : {}),
          },
        },
      });
    }
    const workItemId = stringValue(params?.agentId) ?? stringValue(params?.taskId);
    const parentId = stringValue(params?.toolCallId);
    return createVendorEvent({
      event_id: base.event_id,
      session_id: base.session_id,
      turn_id: base.turn_id,
      source: base.source,
      occurred_at: base.occurred_at,
      raw: base.raw,
      harness: options.harness ?? "unknown",
      namespace: rawType,
      name: method,
      correlation: {
        session_id: message.session_id,
        ...(message.turn_id ? { turn_id: message.turn_id } : {}),
        ...(workItemId ? { work_item_id: workItemId } : {}),
        ...(parentId ? { parent_id: parentId } : {}),
      },
      data: inner.params,
    });
  }

  if (rawType === "user_message_chunk" && (text || content)) {
    return createOpenMAEvent({
      ...base,
      type: "user.message",
      data: {
        ...(text ? { text } : {}),
        ...(content ? { content } : {}),
        ...(messageId ? { message_id: messageId } : {}),
        ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
      },
    });
  }
  // ACP v2/draft adds complete message upserts alongside the v1 chunk
  // updates. They use the same GUI content slots, but a distinct canonical
  // type lets replay/reducers preserve replacement semantics.
  if (rawType === "user_message" && (text || content)) {
    return createOpenMAEvent({
      ...base,
      type: "user.message",
      data: {
        ...(text ? { text } : {}),
        ...(content ? { content } : {}),
        ...(messageId ? { message_id: messageId } : {}),
        ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
      },
    });
  }
  if (rawType === "agent_message_chunk" && (text || content)) {
    return createOpenMAEvent({
      ...base,
      type: "agent.message_chunk",
      data: {
        ...(text ? { text } : {}),
        ...(content ? { content } : {}),
        ...(messageId ? { message_id: messageId } : {}),
        ...(messagePhase ? { phase: messagePhase } : {}),
        ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
      },
    });
  }
  if (rawType === "agent_message" && (text || content)) {
    return createOpenMAEvent({
      ...base,
      type: "agent.message",
      data: {
        ...(text ? { text } : {}),
        ...(content ? { content } : {}),
        ...(messageId ? { message_id: messageId } : {}),
        ...(messagePhase ? { phase: messagePhase } : {}),
        ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
      },
    });
  }
  if (rawType === "agent_thought_chunk" && (text || content)) {
    return createOpenMAEvent({
      ...base,
      type: "agent.thinking",
      data: {
        ...(text ? { text } : {}),
        ...(content ? { content } : {}),
        ...(messageId ? { message_id: messageId } : {}),
        ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
      },
    });
  }
  if (rawType === "agent_thought" && (text || content)) {
    return createOpenMAEvent({
      ...base,
      type: "agent.thinking",
      data: {
        ...(text ? { text } : {}),
        ...(content ? { content } : {}),
        ...(messageId ? { message_id: messageId } : {}),
        ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
      },
    });
  }
  if (rawType === "tool_call_content_chunk") {
    const toolCallId =
      stringValue(inner.toolCallId)
      ?? stringValue(inner.tool_call_id)
      ?? stringValue(inner.id);
    if (!toolCallId || inner.content === undefined) return null;
    return createOpenMAEvent({
      ...base,
      type: "tool.progress",
      data: {
        tool_call_id: toolCallId,
        content: [inner.content],
        ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
      },
    });
  }
  if (rawType === "tool_call" || rawType === "tool_call_update") {
    const tool = canonicalToolLifecycle(inner, rawType, adapterMeta);
    if (!tool) return null;
    return createOpenMAEvent({
      ...base,
      type: tool.type,
      data: tool.data,
    });
  }
  if (rawType === "available_commands_update") {
    return createOpenMAEvent({
      ...base,
      type: "command_catalog.updated",
      data: {
        commands: inner.availableCommands ?? inner.available_commands ?? [],
        ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
      },
    });
  }
  if (rawType === "usage_update") {
    return createOpenMAEvent({
      ...base,
      type: "usage.updated",
      data: {
        ...inner,
        ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
      },
    });
  }
  if (
    rawType === "current_mode_update" ||
    rawType === "config_option_update" ||
    rawType === "session_info_update"
  ) {
    if (rawType === "session_info_update") {
      const canonicalSession =
        canonicalCodexSessionInfo(inner) ?? canonicalPiSessionInfo(inner);
      if (canonicalSession) {
        return createOpenMAEvent({
          ...base,
          type: canonicalSession.type,
          data: {
            ...canonicalSession.data,
            ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
          },
        });
      }
    }
    return createOpenMAEvent({
      ...base,
      type: "capability.updated",
      data: {
        ...inner,
        ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
      },
    });
  }
  if (rawType === "state_update") {
    const state = stringValue(inner.state)?.toLowerCase();
    if (state === "running" || state === "idle") {
      return createOpenMAEvent({
        ...base,
        type: state === "running" ? "session.running" : "session.idle",
        data: {
          state,
          ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
        },
      });
    }
  }
  if (rawType === "plan" || rawType === "plan_update") {
    const plan = asRecord(inner.plan) ?? inner;
    const content = asRecord(plan.content) ?? plan;
    const planId =
      stringValue(plan.planId)
      ?? stringValue(plan.plan_id)
      ?? stringValue(plan.id);
    const entries = Array.isArray(inner.entries)
      ? inner.entries
      : Array.isArray(plan.entries)
        ? plan.entries
        : Array.isArray(content.entries)
          ? content.entries
          : undefined;
    const markdown =
      stringValue(content.markdown)
      ?? stringValue(content.content);
    const uri = stringValue(plan.uri) ?? stringValue(content.uri);
    const data = entries
      ? {
          representation: "items",
          ...(planId ? { plan_id: planId } : {}),
          entries,
          ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
        }
      : markdown
        ? {
            representation: "markdown",
            ...(planId ? { plan_id: planId } : {}),
            document: {
              ...(planId ? { id: planId } : {}),
              ...(stringValue(plan.title) ? { title: plan.title } : {}),
              markdown,
            },
            ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
          }
        : uri
          ? {
              representation: "file",
              ...(planId ? { plan_id: planId } : {}),
              document: {
                ...(planId ? { id: planId } : {}),
                ...(stringValue(plan.title) ? { title: plan.title } : {}),
                uri,
              },
              ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
            }
          : {
              representation: "items",
              update: inner,
              ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
            };
    return createOpenMAEvent({
      ...base,
      type: "plan.updated",
      data,
    });
  }
  if (rawType === "plan_removed") {
    const planId =
      stringValue(inner.planId)
      ?? stringValue(inner.plan_id)
      ?? stringValue(inner.id);
    return createOpenMAEvent({
      ...base,
      type: "plan.removed",
      data: {
        ...(planId ? { plan_id: planId } : {}),
        ...(adapterMeta ? { adapter_meta: adapterMeta } : {}),
      },
    });
  }
  return null;
}

function stablePayload(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function transportEventId(prefix: string, value: unknown): string {
  return `${prefix}:${stablePayload(value)}`;
}

function canonicalEventBase(
  message: { session_id: string; turn_id?: string },
  options: OpenMAEventBridgeOptions,
  harness = options.harness ?? "unknown",
) {
  return {
    session_id: message.session_id,
    ...(message.turn_id ? { turn_id: message.turn_id } : {}),
    source: sourceFor(options, harness),
    occurred_at: options.occurredAt,
  };
}

export function runtimeWorkItemUpdateToOpenMAEvents(
  update: RuntimeWorkItemUpdateInput,
  context: NativeAgentOpenMAEventContext,
): OpenMAEvent[] {
  const source = sourceFor(
    { occurredAt: context.occurredAt, adapter: context.adapter },
    context.adapter ?? "unknown",
  );
  const base = {
    session_id: context.sessionId,
    ...(context.turnId ? { turn_id: context.turnId } : {}),
    work_item_id: update.id,
    ...(update.toolCallId ? { parent_id: update.toolCallId } : {}),
    source,
    occurred_at: context.occurredAt,
  };
  const events: OpenMAEvent[] = [];

  if (update.previousId && update.previousId !== update.id) {
    events.push(createOpenMAEvent({
      ...base,
      event_id: transportEventId(
        `runtime-work-item-reidentified:${context.sessionId}:${update.previousId}`,
        update,
      ),
      type: "work_item.reidentified",
      data: { previous_work_item_id: update.previousId },
    }));
  }

  const eventBase = {
    ...base,
    event_id: transportEventId(
      `runtime-work-item:${context.sessionId}:${update.id}`,
      update,
    ),
  };
  if (update.phase === "classification") {
    events.push(createOpenMAEvent({
      ...eventBase,
      type: "work_item.classified",
      data: { kind: update.kind },
    }));
    return events;
  }
  if (update.phase === "progress") {
    events.push(createOpenMAEvent({
      ...eventBase,
      type: "work_item.progress",
      data: {
        ...(update.progress !== undefined ? { output: update.progress } : {}),
      },
    }));
    return events;
  }
  if (update.status === "running") {
    events.push(createOpenMAEvent({
      ...eventBase,
      type: "work_item.started",
      data: {
        kind: update.kind,
        missing_terminal: false,
        ...(update.title ? { title: update.title } : {}),
        ...(update.command ? { command: update.command } : {}),
        ...(update.canStop !== undefined ? { can_stop: update.canStop } : {}),
      },
    }));
  } else if (update.status === "completed") {
    events.push(createOpenMAEvent({
      ...eventBase,
      type: "work_item.completed",
      data: {
        // Keep the runtime kind on terminal updates as well. Some adapters
        // only emit a terminal notification (without a preceding start), so
        // dropping `other` here would make the reconstructed work-item
        // identity lose its only semantic classification.
        kind: update.kind,
        missing_terminal: false,
        ...(update.title ? { title: update.title } : {}),
        ...(update.result !== undefined ? { result: update.result } : {}),
      },
    }));
  } else {
    events.push(createOpenMAEvent({
      ...eventBase,
      type: update.status === "killed"
        ? "work_item.killed"
        : "work_item.failed",
      data: {
        kind: update.kind,
        missing_terminal: false,
        ...(update.title ? { title: update.title } : {}),
        ...(update.error ? { error: update.error } : {}),
        ...(update.reason ? { reason: update.reason } : {}),
        ...(update.result !== undefined ? { result: update.result } : {}),
      },
    }));
  }
  return events;
}

export function runtimeMonitorEventToOpenMAEvent(
  event: RuntimeMonitorEventInput,
  context: NativeAgentOpenMAEventContext,
): OpenMAEvent {
  return createOpenMAEvent({
    event_id: transportEventId(
      `runtime-monitor-event:${context.sessionId}:${event.monitorId ?? "unattributed"}`,
      event,
    ),
    type: "monitor.event",
    session_id: context.sessionId,
    ...(context.turnId ? { turn_id: context.turnId } : {}),
    ...(event.monitorId ? { work_item_id: event.monitorId } : {}),
    source: sourceFor(
      { occurredAt: context.occurredAt, adapter: context.adapter },
      context.adapter ?? "unknown",
    ),
    occurred_at: context.occurredAt,
    data: {
      description: event.description,
      text: event.text,
    },
  });
}

export function runtimePlanUpdateToOpenMAEvent(
  update: RuntimePlanUpdateInput,
  context: NativeAgentOpenMAEventContext,
): OpenMAEvent {
  return createOpenMAEvent({
    event_id: transportEventId(
      `runtime-plan-update:${context.sessionId}:${update.planId}`,
      update,
    ),
    type: "plan.updated",
    session_id: context.sessionId,
    ...(context.turnId ? { turn_id: context.turnId } : {}),
    source: sourceFor(
      { occurredAt: context.occurredAt, adapter: context.adapter },
      context.adapter ?? "unknown",
    ),
    occurred_at: context.occurredAt,
    data: {
      representation: "items",
      plan_id: update.planId,
      update_mode: update.updateMode,
      entries: update.entries,
    },
  });
}

function backgroundProcessEvent(
  message: Extract<SessionEventOut, { type: "session.background_process" }>,
  options: OpenMAEventBridgeOptions,
): OpenMAEvent {
  const result = {
    exit_code: message.exit_code ?? null,
    signal: message.signal ?? null,
  };
  const base = {
    event_id: `background-process:${message.session_id}:${message.process_id}:${message.seq}`,
    session_id: message.session_id,
    work_item_id: message.process_id,
    seq: message.seq,
    source: {
      kind: "openma" as const,
      adapter: "acp-terminal",
    },
    occurred_at: options.occurredAt,
  };

  switch (message.phase) {
    case "started": {
      const command = message.command ?? "";
      const args = message.args ?? [];
      const title = [command, ...args].filter(Boolean).join(" ") || message.process_id;
      return createOpenMAEvent({
        ...base,
        type: "work_item.started",
        data: {
          kind: "bash",
          title,
          ...(message.command ? { command: message.command } : {}),
          ...(message.args ? { args: message.args } : {}),
          ...(message.cwd ? { cwd: message.cwd } : {}),
          can_stop: true,
        },
      });
    }
    case "output":
      return createOpenMAEvent({
        ...base,
        type: "work_item.output",
        data: { output: message.output ?? "" },
      });
    case "completed":
      return createOpenMAEvent({
        ...base,
        type: "work_item.completed",
        data: { result },
      });
    case "failed":
      return createOpenMAEvent({
        ...base,
        type: "work_item.failed",
        data: {
          error:
            message.error
            ?? (message.exit_code != null
              ? `Process exited with code ${message.exit_code}`
              : "Process failed"),
          result,
        },
      });
    case "killed":
      return createOpenMAEvent({
        ...base,
        type: "work_item.killed",
        data: {
          reason: message.reason ?? "user_kill",
          result,
        },
      });
    case "terminated":
      return createOpenMAEvent({
        ...base,
        type: "work_item.terminated",
        data: {
          reason: message.reason ?? "process_signal",
          result,
        },
      });
  }
}

function nativeSubagentEvent(
  message: Extract<SessionEventOut, { type: "session.native_subagent" }>,
  options: OpenMAEventBridgeOptions,
): OpenMAEvent {
  const base = {
    ...canonicalEventBase(message, options, message.provider),
    event_id: transportEventId(`native-subagent:${message.session_id}:${message.child_id}`, message),
    work_item_id: message.child_id,
    ...(message.tool_call_id ? { parent_id: message.tool_call_id } : {}),
  };

  switch (message.status) {
    case "running":
      return createOpenMAEvent({
        ...base,
        type: "work_item.started",
        data: {
          kind: "agent",
          ...(message.task ? { title: message.task } : {}),
        },
      });
    case "complete":
      return createOpenMAEvent({
        ...base,
        type: "work_item.completed",
        data: {
          kind: "agent",
          ...(message.result !== undefined ? { result: message.result } : {}),
        },
      });
    case "error":
      return createOpenMAEvent({
        ...base,
        type: "work_item.failed",
        data: {
          kind: "agent",
          ...(message.error_message ? { error: message.error_message } : {}),
        },
      });
    case "cancelled":
      return createOpenMAEvent({
        ...base,
        type: "work_item.cancelled",
        data: { kind: "agent", reason: "provider_cancelled" },
      });
    default:
      return createVendorEvent({
        ...base,
        harness: message.provider,
        namespace: "native_subagent",
        name: "update",
        correlation: {
          session_id: message.session_id,
          work_item_id: message.child_id,
          ...(message.tool_call_id ? { parent_id: message.tool_call_id } : {}),
        },
        data: message,
      });
  }
}

/**
 * Convert the already-normalized provider runtime update into the canonical
 * WorkItem lifecycle. Claude and Codex deliberately enter this function with
 * different source data (Task/Agent + `_meta` versus child thread/collab
 * records), while the GUI receives one event vocabulary.
 *
 * An update without an explicit lifecycle status is retained as a vendor
 * event. In particular, a nested child tool correlation must not be guessed
 * to mean that the parent work item started or finished.
 */
export function nativeAgentUpdateToOpenMAEvent(
  update: NativeAgentUpdateInput,
  context: NativeAgentOpenMAEventContext,
): OpenMAEvent | null {
  const childId = update.childId;
  if (!childId) return null;

  const source = sourceFor(
    { occurredAt: context.occurredAt, adapter: context.adapter },
    update.provider,
  );
  const base = {
    event_id: transportEventId(
      `native-agent:${context.sessionId}:${childId}`,
      update,
    ),
    session_id: context.sessionId,
    ...(context.turnId ? { turn_id: context.turnId } : {}),
    work_item_id: childId,
    ...(update.toolCallId ? { parent_id: update.toolCallId } : {}),
    source,
    occurred_at: context.occurredAt,
  };

  if (update.usage) {
    return createOpenMAEvent({
      ...base,
      type: "usage.updated",
      data: {
        input_tokens: update.usage.inputTokens,
        output_tokens: update.usage.outputTokens,
        ...(update.usage.cachedReadTokens !== undefined
          ? { cache_read_input_tokens: update.usage.cachedReadTokens }
          : {}),
        ...(update.usage.cachedWriteTokens !== undefined
          ? { cache_creation_input_tokens: update.usage.cachedWriteTokens }
          : {}),
        total_tokens: update.usage.totalTokens,
      },
    });
  }

  if (update.progress) {
    return createOpenMAEvent({
      ...base,
      type: "work_item.progress",
      data: { output: update.progress },
    });
  }

  switch (update.status) {
    case "running":
      return createOpenMAEvent({
        ...base,
        type: "work_item.started",
        data: {
          kind: "agent",
          ...(update.task ? { title: update.task } : {}),
        },
      });
    case "complete":
      return createOpenMAEvent({
        ...base,
        type: "work_item.completed",
        data: {
          kind: "agent",
          ...(update.result !== undefined ? { result: update.result } : {}),
        },
      });
    case "error":
      return createOpenMAEvent({
        ...base,
        type: "work_item.failed",
        data: {
          kind: "agent",
          ...(update.errorMessage ? { error: update.errorMessage } : {}),
        },
      });
    case "cancelled":
      return createOpenMAEvent({
        ...base,
        type: "work_item.cancelled",
        data: {
          kind: "agent",
          reason: update.reason ?? "provider_cancelled",
          ...(update.errorMessage ? { error: update.errorMessage } : {}),
        },
      });
    case "unknown":
      return createOpenMAEvent({
        ...base,
        type: "work_item.missing_terminal",
        data: {
          kind: "agent",
          missing_terminal: true,
          reason: "parent_turn_completed",
        },
      });
    default:
      return createVendorEvent({
        ...base,
        harness: update.provider,
        namespace: "native_subagent",
        name: "update",
        correlation: {
          session_id: context.sessionId,
          ...(context.turnId ? { turn_id: context.turnId } : {}),
          work_item_id: childId,
          ...(update.toolCallId ? { parent_id: update.toolCallId } : {}),
        },
        data: update,
      });
  }
}

export function nativeAgentReidentifiedToOpenMAEvent(
  update: NativeAgentReidentifiedInput,
  context: NativeAgentOpenMAEventContext,
): OpenMAEvent {
  return createOpenMAEvent({
    event_id: transportEventId(
      `native-agent-reidentified:${context.sessionId}:${update.previousChildId}`,
      update,
    ),
    session_id: context.sessionId,
    ...(context.turnId ? { turn_id: context.turnId } : {}),
    work_item_id: update.childId,
    ...(update.toolCallId ? { parent_id: update.toolCallId } : {}),
    source: sourceFor(
      { occurredAt: context.occurredAt, adapter: context.adapter },
      update.provider,
    ),
    occurred_at: context.occurredAt,
    type: "work_item.reidentified",
    data: { previous_work_item_id: update.previousChildId },
  });
}

export function nativeAgentTranscriptToOpenMAEvent(
  update: NativeAgentTranscriptInput,
  context: NativeAgentOpenMAEventContext & { childId: string },
): OpenMAEvent | null {
  const base = {
    event_id: transportEventId(
      `native-transcript:${context.sessionId}:${context.childId}`,
      update,
    ),
    session_id: context.sessionId,
    ...(context.turnId ? { turn_id: context.turnId } : {}),
    work_item_id: context.childId,
    parent_id: update.parentToolUseId,
    source: sourceFor(
      { occurredAt: context.occurredAt, adapter: context.adapter },
      update.provider,
    ),
    occurred_at: context.occurredAt,
    ...(update.payload !== undefined
      ? {
          raw: {
            kind: "raw" as const,
            source: "adapter" as const,
            method: "nested_transcript",
            event_type: update.kind,
            payload: update.payload,
            received_at: context.occurredAt,
            reason: "unknown" as const,
          },
        }
      : {}),
  };

  if (update.kind === "text" && update.text) {
    return createOpenMAEvent({
      ...base,
      type: "agent.message_chunk",
      data: {
        text: update.text,
        ...(update.messageId ? { message_id: update.messageId } : {}),
      },
    });
  }
  if (update.kind === "thought" && update.text) {
    return createOpenMAEvent({
      ...base,
      type: "agent.thinking",
      data: {
        text: update.text,
        ...(update.messageId ? { message_id: update.messageId } : {}),
      },
    });
  }
  if (update.kind === "content" && update.content) {
    return createOpenMAEvent({
      ...base,
      type: update.contentChannel === "thought"
        ? "agent.thinking"
        : "agent.message_chunk",
      data: {
        content: update.content,
        ...(update.messageId ? { message_id: update.messageId } : {}),
      },
    });
  }
  if (update.kind === "tool" && update.toolCallId) {
    return createOpenMAEvent({
      ...base,
      type: "tool.progress",
      data: {
        tool_call_id: update.toolCallId,
        ...(update.toolName ? { tool_name: update.toolName } : {}),
        payload: update.payload,
      },
    });
  }
  if (update.kind === "usage" && update.usage) {
    return createOpenMAEvent({
      ...base,
      type: "usage.updated",
      data: {
        input_tokens: update.usage.inputTokens,
        output_tokens: update.usage.outputTokens,
        ...(update.usage.cachedReadTokens !== undefined
          ? { cache_read_input_tokens: update.usage.cachedReadTokens }
          : {}),
        ...(update.usage.cachedWriteTokens !== undefined
          ? { cache_creation_input_tokens: update.usage.cachedWriteTokens }
          : {}),
        total_tokens: update.usage.totalTokens,
      },
    });
  }
  return null;
}

export function toOpenMAEvent(
  message: SessionEventOut,
  options: OpenMAEventBridgeOptions,
): OpenMAEvent | null {
  switch (message.type) {
    case "session.event": {
      const canonical = canonicalAcpUpdateEvent(message, options);
      if (canonical) return canonical;
      const rawType = eventType(message.event);
      return createRawEvent({
        event_id: transportEventId(`acp:${message.session_id}:${message.turn_id}`, message.event),
        session_id: message.session_id,
        turn_id: message.turn_id,
        source: sourceFor(options),
        occurred_at: options.occurredAt,
        source_kind: "acp",
        method: "session/update",
        ...(rawType ? { event_type: rawType } : {}),
        payload: message.event,
        reason: "unsupported",
      });
    }
    case "session.native_subagent":
      return nativeSubagentEvent(message, options);
    case "session.background_process":
      return backgroundProcessEvent(message, options);
    case "session.ready":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options, options.harness ?? message.agent_id),
        event_id: transportEventId(`session-started:${message.session_id}`, message.acp_session_id),
        type: "session.started",
        data: {
          acp_session_id: message.acp_session_id,
          agent_id: message.agent_id,
          cwd: message.cwd,
          ...(message.additional_directories
            ? { additional_directories: message.additional_directories }
            : {}),
          ...(message.project_id ? { project_id: message.project_id } : {}),
          ...(message.config_options !== undefined
            ? { config_options: message.config_options }
            : {}),
          ...(message.modes ? { modes: message.modes } : {}),
          ...(message.protocol_version !== undefined
            ? { protocol_version: message.protocol_version }
            : {}),
          ...(message.agent_info !== undefined
            ? { agent_info: message.agent_info }
            : {}),
          ...(message.agent_capabilities !== undefined
            ? { agent_capabilities: message.agent_capabilities }
            : {}),
          ...(message.initialize_meta
            ? { adapter_meta: message.initialize_meta }
            : {}),
          ...(message.session_setup_meta
            ? { session_setup_meta: message.session_setup_meta }
            : {}),
          ...(message.supports_session_fork !== undefined
            || message.supports_session_list !== undefined
            || message.supports_session_delete !== undefined
            || message.supports_session_resume !== undefined
            || message.supports_session_close !== undefined
            || message.supports_additional_directories !== undefined
            || message.supports_logout !== undefined
            || message.supports_providers !== undefined
            || message.supports_nes !== undefined
            || message.supports_steering !== undefined
            ? {
                capabilities: {
                  ...(message.supports_session_fork !== undefined
                    ? { session_fork: message.supports_session_fork }
                    : {}),
                  ...(message.supports_session_list !== undefined
                    ? { session_list: message.supports_session_list }
                    : {}),
                  ...(message.supports_session_delete !== undefined
                    ? { session_delete: message.supports_session_delete }
                    : {}),
                  ...(message.supports_session_resume !== undefined
                    ? { session_resume: message.supports_session_resume }
                    : {}),
                  ...(message.supports_session_close !== undefined
                    ? { session_close: message.supports_session_close }
                    : {}),
                  ...(message.supports_additional_directories !== undefined
                    ? {
                        additional_directories:
                          message.supports_additional_directories,
                      }
                    : {}),
                  ...(message.supports_logout !== undefined
                    ? { logout: message.supports_logout }
                    : {}),
                  ...(message.supports_providers !== undefined
                    ? { providers: message.supports_providers }
                    : {}),
                  ...(message.supports_nes !== undefined
                    ? { nes: message.supports_nes }
                    : {}),
                  ...(message.supports_steering !== undefined
                    ? { steering: message.supports_steering }
                    : {}),
                },
              }
            : {}),
        },
      });
    case "session.permission_response":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options),
        event_id: transportEventId(
          `permission-response:${message.session_id}:${message.request_id}`,
          message,
        ),
        type: "user.permission_response",
        source: { kind: "user" },
        data: {
          request_id: message.request_id,
          ...(message.option_id !== undefined
            ? { option_id: message.option_id }
            : {}),
          outcome: message.outcome,
        },
      });
    case "session.fs_write_response":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options),
        event_id: transportEventId(
          `fs-write-response:${message.session_id}:${message.request_id}`,
          message,
        ),
        type: "user.fs_write_response",
        source: { kind: "user" },
        data: {
          request_id: message.request_id,
          path: message.path,
          outcome: message.outcome,
        },
      });
    case "session.elicitation_response":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options),
        event_id: transportEventId(
          `elicitation-response:${message.session_id}:${message.request_id}`,
          message,
        ),
        type: "user.elicitation_response",
        source: { kind: "user" },
        data: {
          request_id: message.request_id,
          action: message.action,
          ...(message.content ? { content: message.content } : {}),
          ...(message.mode ? { mode: message.mode } : {}),
          ...(message.elicitation_id
            ? { elicitation_id: message.elicitation_id }
            : {}),
        },
        raw: {
          kind: "raw",
          source: "transport",
          event_type: "elicitation_response",
          payload: message,
          received_at: options.occurredAt,
          reason: "unknown",
        },
      });
    case "session.command_invoked":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options),
        event_id: transportEventId(
          `command-invoked:${message.session_id}:${message.turn_id}`,
          message,
        ),
        type: "user.message",
        source: { kind: "user" },
        data: {
          input_kind: "command",
          command: message.command,
          ...(message.args ? { args: message.args } : {}),
          text: message.text,
        },
        raw: {
          kind: "raw",
          source: "transport",
          event_type: "command_invoked",
          payload: message,
          received_at: options.occurredAt,
          reason: "unknown",
        },
      });
    case "session.complete":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options),
        event_id: transportEventId(`turn-completed:${message.session_id}:${message.turn_id}`, message.turn_id),
        type: "turn.completed",
        data: {
          ...(message.stop_reason ? { stop_reason: message.stop_reason } : {}),
          ...(message.usage ? { usage: message.usage } : {}),
          ...(message.meta ? { adapter_meta: message.meta } : {}),
        },
      });
    case "session.cancel_requested":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options),
        event_id: transportEventId(
          `user-interrupt:${message.session_id}:${message.turn_id}`,
          message.turn_id,
        ),
        type: "user.interrupt",
        source: { kind: "user" },
        data: { reason: "user_stop" },
      });
    case "session.tool_cancelled":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options),
        event_id: transportEventId(
          `tool-cancelled:${message.session_id}:${message.turn_id}:${message.tool_call_id}`,
          message,
        ),
        type: "tool.cancelled",
        source: { kind: "openma", adapter: "acp-client" },
        data: {
          tool_call_id: message.tool_call_id,
          status: "cancelled",
          reason: message.reason,
        },
        raw: {
          kind: "raw",
          source: "transport",
          event_type: "session.tool_cancelled",
          payload: message,
          received_at: options.occurredAt,
          reason: "unknown",
        },
      });
    case "session.cancelled":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options),
        event_id: transportEventId(
          `turn-cancelled:${message.session_id}:${message.turn_id}`,
          message.turn_id,
        ),
        type: "turn.cancelled",
        data: { reason: "user_stop" },
      });
    case "session.steering":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options),
        event_id: transportEventId(
          `user-steering:${message.session_id}:${message.turn_id}`,
          message,
        ),
        type: "user.message",
        source: { kind: "user" },
        data: {
          text: message.text,
          active_turn_id: message.active_turn_id,
          ...(message.content ? { content: message.content } : {}),
          ...(message.prompt_intent ? { prompt_intent: message.prompt_intent } : {}),
          requested_delivery: message.requested_delivery,
          effective_delivery: message.effective_delivery,
          ...(message.delivery_degraded !== undefined
            ? { delivery_degraded: message.delivery_degraded }
            : {}),
          outcome: message.outcome,
          ...(message.error ? { error: message.error } : {}),
        },
      });
    case "session.queue_update":
      return createOpenMAEvent({
        ...canonicalEventBase(
          { session_id: message.session_id, turn_id: message.active_turn_id ?? undefined },
          options,
        ),
        event_id: transportEventId(`turn-queued:${message.session_id}`, message),
        type: "turn.queued",
        data: {
          mode: message.mode,
          active_turn_id: message.active_turn_id,
          queued: message.queued,
          ...(message.steering_turn_ids ? { steering_turn_ids: message.steering_turn_ids } : {}),
        },
      });
    case "session.error":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options),
        event_id: transportEventId(`session-error:${message.session_id}`, message),
        type: "session.error",
        data: {
          message: message.message,
          ...(message.code ? { code: message.code } : {}),
          ...(message.agent_id ? { agent_id: message.agent_id } : {}),
          ...(message.auth ? { auth: message.auth } : {}),
        },
      });
    case "session.disposed":
      return createOpenMAEvent({
        ...canonicalEventBase(message, options),
        event_id: `session-terminated:${message.session_id}`,
        type: "session.terminated",
        data: { reason: "disposed" },
      });
  }
  return null;
}

export function attachOpenMAEvent(
  message: SessionEventOut,
  options: OpenMAEventBridgeOptions,
): SessionEventOut {
  const event = toOpenMAEvent(message, options);
  return event ? { ...message, openma_event: event } : message;
}
