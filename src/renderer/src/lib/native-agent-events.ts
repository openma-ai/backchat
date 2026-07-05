import type { ToolEntry } from "./reduce-turn";

export type NativeAgentProvider = "codex" | "claude";

export type NativeAgentStatus = "running" | "complete" | "error" | "cancelled";
export type NativeAgentOperation =
  | "codex_spawn"
  | "codex_wait"
  | "codex_close"
  | "claude_agent";

export interface NativeAgentContext {
  provider: NativeAgentProvider;
  toolCallId: string;
  childId: string;
  operation?: NativeAgentOperation;
}

export interface NativeAgentUpdate {
  provider: NativeAgentProvider;
  operation?: NativeAgentOperation;
  toolCallId?: string;
  childId?: string;
  task?: string;
  agentType?: string;
  nickname?: string;
  forkContext?: boolean;
  status?: NativeAgentStatus;
  result?: string;
  errorMessage?: string;
  closed?: boolean;
  childToolCallId?: string;
  childToolName?: string;
}

type ToolLike = Partial<ToolEntry> & { toolCallId: string };

export function detectNativeAgentToolEvent(
  tool: ToolLike,
  context?: NativeAgentContext,
): NativeAgentUpdate[] {
  if (tool.parentToolUseId && context) {
    return [
      {
        provider: context.provider,
        operation: context.operation,
        toolCallId: context.toolCallId,
        childId: context.childId,
        childToolCallId: tool.toolCallId,
        childToolName: asString(tool.toolName) ?? asString(tool.title),
      },
    ];
  }

  const name = normalizeToolName(tool.toolName ?? tool.title);

  if (name === "spawn_agent" || name === "spawnagent") return [detectCodexSpawn(tool)];
  if (name === "wait_agent" || name === "wait") return detectCodexWait(tool);
  if (name === "close_agent" || name === "closeagent") return [detectCodexClose(tool)];
  if (name === "task" || name === "agent") return [detectClaudeSpawn(tool, name)];

  if (context) return detectContextualResult(tool, context);
  return [];
}

export function detectNativeAgentRawEvent(event: unknown): NativeAgentUpdate[] {
  const inner = unwrapEvent(event);
  if (inner.type !== "collab_tool_call") return [];
  const tool = normalizeToolName(asString(inner.tool));
  if (tool === "spawn_agent") {
    const task = asString(inner.prompt);
    const children = stringArray(inner.receiver_thread_ids);
    return children.map((childId) => ({
      provider: "codex",
      operation: "codex_spawn",
      childId,
      task,
      status: "running",
    }));
  }
  if (tool === "wait" || tool === "wait_agent") {
    return codexStateUpdates(stringArray(inner.receiver_thread_ids), inner.agents_states);
  }
  if (tool === "close_agent") {
    return stringArray(inner.receiver_thread_ids).map((childId) => ({
      provider: "codex",
      operation: "codex_close",
      childId,
      status: "complete",
      closed: true,
    }));
  }
  return [];
}

function detectCodexSpawn(tool: ToolLike): NativeAgentUpdate {
  const input = objectValue(tool.rawInput);
  const output = objectValue(tool.rawOutput);
  const receiverThreadIds = stringArray(input.receiverThreadIds ?? input.receiver_thread_ids);
  const childId =
    asString(output.agent_id) ??
    asString(output.agentId) ??
    receiverThreadIds[0];
  const failed = isFailed(tool.status);
  return {
    provider: "codex",
    operation: "codex_spawn",
    toolCallId: tool.toolCallId,
    childId: childId ?? fallbackChildId("codex", tool.toolCallId),
    task: asString(input.message) ?? asString(input.prompt) ?? asString(input.task),
    agentType: asString(input.agent_type) ?? asString(input.agentType),
    nickname: asString(output.nickname) ?? asString(output.name),
    forkContext: asBoolean(input.fork_context) ?? asBoolean(input.forkContext),
    status: failed ? "error" : "running",
    errorMessage: failed ? stringResult(tool.rawOutput) : undefined,
  };
}

function detectCodexWait(tool: ToolLike): NativeAgentUpdate[] {
  const input = objectValue(tool.rawInput);
  const output = objectValue(tool.rawOutput);
  const targetIds = stringArray(input.targets ?? input.receiverThreadIds ?? input.receiver_thread_ids);
  const inputStates = objectValue(input.agentsStates ?? input.agents_states);
  if (Object.keys(inputStates).length > 0) {
    return codexStateUpdates(targetIds, inputStates).map((update) => ({
      ...update,
      toolCallId: tool.toolCallId,
    }));
  }
  const statusByTarget = objectValue(output.status);
  const ids = new Set([...targetIds, ...Object.keys(statusByTarget)]);

  if (ids.size === 0 && asBoolean(output.timed_out)) {
    return targetIds.map((childId) => ({
      provider: "codex" as const,
      operation: "codex_wait" as const,
      toolCallId: tool.toolCallId,
      childId,
      status: "running" as const,
    }));
  }

  return [...ids].map((childId) => {
    const status = objectValue(statusByTarget[childId]);
    const completed = stringFromUnknown(status.completed);
    const failed = stringFromUnknown(status.failed ?? status.error);
    const cancelled = status.cancelled ?? status.canceled;
    return {
      provider: "codex",
      operation: "codex_wait" as const,
      toolCallId: tool.toolCallId,
      childId,
      status: failed
        ? "error"
        : cancelled
          ? "cancelled"
          : completed !== undefined
            ? "complete"
            : "running",
      result: completed,
      errorMessage: failed,
    };
  });
}

function detectCodexClose(tool: ToolLike): NativeAgentUpdate {
  const input = objectValue(tool.rawInput);
  const output = objectValue(tool.rawOutput);
  const inputStates = objectValue(input.agentsStates ?? input.agents_states);
  const previous = objectValue(output.previous_status ?? output.previousStatus);
  const receiverThreadIds = stringArray(input.receiverThreadIds ?? input.receiver_thread_ids);
  const stateUpdates = Object.keys(inputStates).length > 0
    ? codexStateUpdates(receiverThreadIds, inputStates)
    : [];
  const stateUpdate = stateUpdates[0];
  const completed = stringFromUnknown(previous.completed);
  const failed = stringFromUnknown(previous.failed ?? previous.error);
  return {
    provider: "codex",
    operation: "codex_close",
    toolCallId: tool.toolCallId,
    childId:
      asString(input.target) ??
      asString(input.agent_id) ??
      asString(input.agentId) ??
      stateUpdate?.childId ??
      receiverThreadIds[0],
    status: stateUpdate?.status ?? (failed ? "error" : completed !== undefined ? "complete" : undefined),
    result: stateUpdate?.result ?? completed,
    errorMessage: stateUpdate?.errorMessage ?? failed,
    closed: true,
  };
}

function detectClaudeSpawn(tool: ToolLike, name: "task" | "agent"): NativeAgentUpdate {
  const input = objectValue(tool.rawInput);
  const failed = isFailed(tool.status);
  return {
    provider: "claude",
    operation: "claude_agent",
    toolCallId: tool.toolCallId,
    childId: structuredChildIdFromMeta(tool) ?? fallbackChildId("claude", tool.toolCallId),
    task:
      asString(input.description) ??
      asString(input.activeForm) ??
      asString(input.prompt) ??
      asString(input.message) ??
      name,
    agentType:
      asString(input.subagent_type) ??
      asString(input.agent_type) ??
      asString(input.agentType),
    status: failed ? "error" : "running",
    errorMessage: failed ? stringResult(tool.rawOutput) : undefined,
  };
}

function detectContextualResult(
  tool: ToolLike,
  context: NativeAgentContext,
): NativeAgentUpdate[] {
  if (context.operation === "codex_spawn") {
    const spawned = detectCodexSpawn(tool);
    return [
      {
        ...spawned,
        toolCallId: context.toolCallId,
        childId: structuredChildId(tool.rawOutput) ?? context.childId,
        status: spawned.status === "error" ? "error" : "running",
      },
    ];
  }
  if (context.operation === "codex_wait") {
    const updates = detectCodexWait(tool);
    return updates.length > 0
      ? updates.map((update) => ({ ...update, toolCallId: context.toolCallId }))
      : [
          {
            provider: context.provider,
            operation: context.operation,
            toolCallId: context.toolCallId,
            childId: context.childId,
            status: "running",
          },
        ];
  }
  if (context.operation === "codex_close") {
    const closed = detectCodexClose(tool);
    return [
      {
        ...closed,
        toolCallId: context.toolCallId,
        childId: closed.childId ?? context.childId,
      },
    ];
  }

  const result = stringResult(tool.rawOutput);
  const childId =
    structuredChildIdFromMeta(tool) ??
    structuredChildId(tool.rawOutput) ??
    context.childId;
  const failed = isFailed(tool.status);
  const asyncLaunch = context.provider === "claude" && isClaudeAsyncLaunch(tool);
  return [
    {
      provider: context.provider,
      operation: context.operation,
      toolCallId: context.toolCallId,
      childId,
      status: failed
        ? "error"
        : asyncLaunch
          ? "running"
          : tool.status === "completed"
            ? "complete"
            : "running",
      result: failed ? undefined : result,
      errorMessage: failed ? result : undefined,
    },
  ];
}

function codexStateUpdates(childIds: string[], states: unknown): NativeAgentUpdate[] {
  const stateRecords = objectValue(states);
  const ids = childIds.length > 0 ? childIds : Object.keys(stateRecords);
  const fallbackState =
    ids.length === 1
      ? Object.values(stateRecords).find(
          (state) => state && typeof state === "object" && !Array.isArray(state),
        )
      : undefined;
  return ids.map((childId) => {
    const childState = objectValue(stateRecords[childId] ?? fallbackState);
    const state = asString(childState.status) ?? asString(childState.state);
    const message = stringFromUnknown(childState.message);
    return {
      provider: "codex",
      operation: "codex_wait",
      childId,
      status:
        state === "completed"
          ? "complete"
          : state === "failed" || state === "error"
            ? "error"
            : state === "cancelled" || state === "canceled"
              ? "cancelled"
              : "running",
      result: state === "completed" ? message : undefined,
      errorMessage: state === "failed" || state === "error" ? message : undefined,
    };
  });
}

function normalizeToolName(value: unknown): string {
  const name = asString(value);
  if (!name) return "";
  return name.trim().split(/[./:]/).pop()?.toLowerCase() ?? "";
}

function fallbackChildId(provider: NativeAgentProvider, toolCallId: string): string {
  return `${provider}:${toolCallId}`;
}

function structuredChildIdFromMeta(tool: ToolLike): string | undefined {
  const meta = objectValue(tool.meta);
  const claudeMeta = objectValue(meta.claudeCode);
  const toolResponse = objectValue(claudeMeta.toolResponse);
  return (
    asString(toolResponse.agentId) ??
    asString(toolResponse.agent_id) ??
    asString(claudeMeta.agentId) ??
    asString(claudeMeta.agent_id)
  );
}

function isClaudeAsyncLaunch(tool: ToolLike): boolean {
  const meta = objectValue(tool.meta);
  const claudeMeta = objectValue(meta.claudeCode);
  const toolResponse = objectValue(claudeMeta.toolResponse);
  return (
    asBoolean(toolResponse.isAsync) === true ||
    asString(toolResponse.status) === "async_launched"
  );
}

function unwrapEvent(event: unknown): Record<string, unknown> {
  const record = objectValue(event);
  const update = objectValue(record.update);
  if (Object.keys(update).length > 0) return update;
  const item = objectValue(record.item);
  return Object.keys(item).length > 0 ? item : record;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function stringResult(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const block = part as { text?: unknown; content?: unknown };
        return typeof block.text === "string"
          ? block.text
          : typeof block.content === "string"
            ? block.content
            : "";
      })
      .join("");
    return text.length > 0 ? text : undefined;
  }
  return stringFromUnknown(value);
}

function structuredChildId(value: unknown): string | undefined {
  const object = objectValue(value);
  return (
    asString(object.agent_id) ??
    asString(object.agentId) ??
    asString(object.child_thread_id) ??
    asString(object.childThreadId)
  );
}

function isFailed(status: unknown): boolean {
  return status === "failed" || status === "error";
}
