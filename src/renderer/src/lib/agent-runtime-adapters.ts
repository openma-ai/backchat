import type { ToolEntry } from "./reduce-turn";
import {
  detectClaudeCodeNativeAgentToolEvent,
  detectClaudeCodeNativeAgentTranscript,
  detectCodexNativeAgentRawEvent,
  detectCodexNativeAgentToolEvent,
  type NativeAgentContext,
  type NativeAgentProvider,
  type NativeAgentTranscriptUpdate,
  type NativeAgentUpdate,
} from "./native-agent-events";
import {
  extractCodexFileCitations,
  extractFilePaths,
  extractToolContentSources,
  isDeliverableOutputPath,
} from "./session-artifacts";
import type { SessionGoal, WorkspaceSourceRef } from "./session-types";

export type RuntimeToolEvent = Partial<ToolEntry> & { toolCallId: string };

export interface RuntimePlanUpdate {
  planId: string;
  updateMode: "replace" | "merge";
  entries: Array<{
    id?: string;
    content: string;
    status?: "pending" | "in_progress" | "completed" | "cancelled";
    priority?: "high" | "medium" | "low";
  }>;
}

export interface RuntimeWorkItemUpdate {
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

export interface RuntimeMonitorEvent {
  description: string;
  text: string;
  monitorId?: string;
}

export interface RuntimeBackgroundWorkItemLevel {
  eventId: string;
  liveTaskIds: string[];
  liveWorkItems: RuntimeWorkItemUpdate[];
}

export interface RuntimeWorkspaceArtifacts {
  outputs: {
    files: string[];
    services: string[];
  };
  sources: WorkspaceSourceRef[];
}

export interface RuntimeSessionGoalInput {
  update: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface SessionGoalUpdateInput extends RuntimeSessionGoalInput {
  agentId: string;
}

export type SessionGoalUpdateReader = (
  input: SessionGoalUpdateInput,
) => SessionGoal | null | undefined;

/**
 * Provider boundary consumed by the session store.
 *
 * Provider-specific tool names and event metadata stop here. The store and
 * New-tab UI only consume normalized native-agent updates and output
 * artifacts.
 */
export interface AgentRuntimeAdapter {
  readonly provider: NativeAgentProvider | "kimi" | "generic-acp";
  matches(agentId: string): boolean;
  nativeAgentToolUpdates(
    tool: RuntimeToolEvent,
    context?: NativeAgentContext,
    logicalTool?: RuntimeToolEvent,
  ): NativeAgentUpdate[];
  nativeAgentRawUpdates(event: unknown): NativeAgentUpdate[];
  nativeAgentTranscriptUpdates(event: unknown): NativeAgentTranscriptUpdate[];
  backgroundWorkItemToolUpdates(
    tool: RuntimeToolEvent,
    logicalTool?: RuntimeToolEvent,
  ): RuntimeWorkItemUpdate[];
  planToolUpdates(tool: RuntimeToolEvent): RuntimePlanUpdate[];
  backgroundWorkItemRawUpdates?(event: unknown): RuntimeWorkItemUpdate[];
  backgroundWorkItemLevel?(event: unknown): RuntimeBackgroundWorkItemLevel | undefined;
  monitorRawEvents?(event: unknown): RuntimeMonitorEvent[];
  sessionGoalUpdate(
    input: RuntimeSessionGoalInput,
  ): SessionGoal | null | undefined;
  sessionThreadStatusUpdate(
    input: RuntimeSessionGoalInput,
  ): string | undefined;
  assistantNativeAgentUpdates?(text: string): NativeAgentUpdate[];
  assistantBackgroundWorkItemUpdates?(text: string): RuntimeWorkItemUpdate[];
  workspaceArtifacts(tool: RuntimeToolEvent): RuntimeWorkspaceArtifacts;
  rawWorkspaceArtifacts?(event: unknown): RuntimeWorkspaceArtifacts;
  assistantArtifacts?(text: string): RuntimeWorkspaceArtifacts;
  settleNativeAgentOnParentTurnComplete:
    | false
    | "complete"
    | "missing_terminal";
}

const CLAUDE_CODE_MUTATING_TOOLS = new Set([
  "edit",
  "multiedit",
  "notebookedit",
  "write",
]);

const CLAUDE_CODE_WEB_SOURCE_TOOLS = new Set([
  "webfetch",
]);

const PI_MUTATING_TOOLS = new Set([
  "edit",
  "write",
]);

export const genericAcpRuntimeAdapter: AgentRuntimeAdapter = {
  provider: "generic-acp",
  matches: () => false,
  nativeAgentToolUpdates: () => [],
  nativeAgentRawUpdates: () => [],
  nativeAgentTranscriptUpdates: () => [],
  backgroundWorkItemToolUpdates: () => [],
  planToolUpdates: () => [],
  sessionGoalUpdate: () => undefined,
  sessionThreadStatusUpdate: () => undefined,
  workspaceArtifacts: standardAcpArtifacts,
  settleNativeAgentOnParentTurnComplete: false,
};

export const codexRuntimeAdapter: AgentRuntimeAdapter = {
  provider: "codex",
  matches(agentId) {
    const normalized = normalizeAgentId(agentId);
    return normalized === "codex-acp" || normalized.includes("codex");
  },
  nativeAgentToolUpdates(tool, context) {
    return detectCodexNativeAgentToolEvent(tool, context);
  },
  nativeAgentRawUpdates(event) {
    return detectCodexNativeAgentRawEvent(event);
  },
  nativeAgentTranscriptUpdates: () => [],
  backgroundWorkItemToolUpdates: () => [],
  planToolUpdates: () => [],
  sessionGoalUpdate: codexSessionGoalUpdate,
  sessionThreadStatusUpdate: codexSessionThreadStatusUpdate,
  workspaceArtifacts(tool) {
    const standard = standardAcpArtifacts(tool);
    if (tool.status !== "completed") return standard;
    const files = codexGeneratedMediaPaths(tool);
    const codexSources = codexOpenedPageUrls(tool).map(
      (uri): WorkspaceSourceRef => ({ kind: "web", uri }),
    );
    return {
      outputs: {
        files: unique([...standard.outputs.files, ...files]),
        services: standard.outputs.services,
      },
      sources: uniqueSources([...standard.sources, ...codexSources]),
    };
  },
  assistantArtifacts(text) {
    const citations = extractCodexFileCitations(text);
    return {
      outputs: { files: citations.outputs, services: [] },
      sources: citations.sources.map(
        (uri): WorkspaceSourceRef => ({ kind: "file", uri }),
      ),
    };
  },
  settleNativeAgentOnParentTurnComplete: "missing_terminal",
};

export const claudeCodeRuntimeAdapter: AgentRuntimeAdapter = {
  provider: "claude",
  matches(agentId) {
    const normalized = normalizeAgentId(agentId);
    return (
      normalized === "claude-acp"
      || normalized.includes("claude-code")
      || normalized.includes("claude")
      || normalized === "cc"
      || normalized.startsWith("cc-")
    );
  },
  nativeAgentToolUpdates(tool, context) {
    return detectClaudeCodeNativeAgentToolEvent(tool, context);
  },
  nativeAgentRawUpdates: claudeRawNativeAgentUpdates,
  nativeAgentTranscriptUpdates(event) {
    return detectClaudeCodeNativeAgentTranscript(event);
  },
  backgroundWorkItemToolUpdates(tool, logicalTool) {
    return claudeBackgroundWorkItemUpdates(logicalTool ?? tool);
  },
  planToolUpdates: () => [],
  backgroundWorkItemRawUpdates: claudeRawBackgroundWorkItemUpdates,
  backgroundWorkItemLevel: claudeRawBackgroundWorkItemLevel,
  monitorRawEvents: claudeRawMonitorEvents,
  sessionGoalUpdate: () => undefined,
  sessionThreadStatusUpdate: () => undefined,
  workspaceArtifacts(tool) {
    return artifactsForProviderTool(tool, {
      mutatingTools: CLAUDE_CODE_MUTATING_TOOLS,
      webSourceTools: CLAUDE_CODE_WEB_SOURCE_TOOLS,
    });
  },
  settleNativeAgentOnParentTurnComplete: "missing_terminal",
};

export const openCodeRuntimeAdapter =
  createOpenCodeFamilyRuntimeAdapter("opencode");

export const kiloRuntimeAdapter =
  createOpenCodeFamilyRuntimeAdapter("kilo");

export const cursorRuntimeAdapter: AgentRuntimeAdapter = {
  provider: "cursor",
  matches(agentId) {
    const normalized = normalizeAgentId(agentId);
    return normalized === "cursor" || normalized === "cursor-acp";
  },
  nativeAgentToolUpdates(tool, context, logicalTool) {
    return cursorTaskToolUpdates(logicalTool ?? tool, context);
  },
  nativeAgentRawUpdates: cursorTaskExtensionUpdates,
  nativeAgentTranscriptUpdates: () => [],
  backgroundWorkItemToolUpdates: () => [],
  planToolUpdates: () => [],
  sessionGoalUpdate: () => undefined,
  sessionThreadStatusUpdate: () => undefined,
  workspaceArtifacts: standardAcpArtifacts,
  rawWorkspaceArtifacts: cursorExtensionArtifacts,
  settleNativeAgentOnParentTurnComplete: false,
};

/**
 * pi-acp v0.0.33 reports Pi's built-in `write` and `edit` executions as
 * structured ACP tool calls whose title is the tool name and whose raw input
 * contains `path` or `file_path`. Pi has no built-in web-fetch or subagent
 * event contract, so this adapter deliberately leaves Sources and native
 * Agents empty instead of inferring them from reads or similarly named
 * extension tools.
 */
export const piRuntimeAdapter: AgentRuntimeAdapter = {
  provider: "pi",
  matches(agentId) {
    const normalized = normalizeAgentId(agentId);
    return normalized === "pi-acp" || normalized === "pi";
  },
  nativeAgentToolUpdates: () => [],
  nativeAgentRawUpdates: () => [],
  nativeAgentTranscriptUpdates: () => [],
  backgroundWorkItemToolUpdates: () => [],
  planToolUpdates: () => [],
  sessionGoalUpdate: () => undefined,
  sessionThreadStatusUpdate: () => undefined,
  workspaceArtifacts(tool) {
    return artifactsForProviderTool(tool, {
      mutatingTools: PI_MUTATING_TOOLS,
      webSourceTools: new Set(),
    });
  },
  settleNativeAgentOnParentTurnComplete: false,
};

/**
 * @moonshot-ai/kimi-code 0.33.0 exposes its `Agent` invocation through the
 * standard ACP tool_call/tool_call_update surface. The live ACP trace carries
 * no namespaced `_meta` or separate child lifecycle, so it deliberately stays
 * an ordinary Tool instead of being inferred as a native Agent or Background
 * work item.
 */
export const kimiRuntimeAdapter: AgentRuntimeAdapter = {
  provider: "kimi",
  matches(agentId) {
    const normalized = normalizeAgentId(agentId);
    return normalized === "kimi-acp"
      || normalized === "kimi-code-acp"
      || normalized === "kimi-code"
      || normalized === "kimi";
  },
  nativeAgentToolUpdates: () => [],
  nativeAgentRawUpdates: () => [],
  nativeAgentTranscriptUpdates: () => [],
  backgroundWorkItemToolUpdates: () => [],
  planToolUpdates: () => [],
  sessionGoalUpdate: () => undefined,
  sessionThreadStatusUpdate: () => undefined,
  workspaceArtifacts: standardAcpArtifacts,
  settleNativeAgentOnParentTurnComplete: false,
};

const providerAdapters = [
  codexRuntimeAdapter,
  claudeCodeRuntimeAdapter,
  openCodeRuntimeAdapter,
  kiloRuntimeAdapter,
  cursorRuntimeAdapter,
  piRuntimeAdapter,
  kimiRuntimeAdapter,
] as const;

export function resolveAgentRuntimeAdapter(
  agentId: string | undefined,
): AgentRuntimeAdapter | undefined {
  if (!agentId) return undefined;
  return providerAdapters.find((adapter) => adapter.matches(agentId));
}

export function runtimeAdapterForProvider(
  provider: NativeAgentProvider,
): AgentRuntimeAdapter | undefined {
  return providerAdapters.find((adapter) => adapter.provider === provider);
}

/** Composition-root adapter lookup for the SessionStore Goal port. The store
 * consumes only the normalized result; raw harness event shapes stop inside
 * the matching adapter. */
export const readSessionGoalUpdateFromAgentAdapter: SessionGoalUpdateReader = (
  input,
) => {
  const adapter =
    resolveAgentRuntimeAdapter(input.agentId) ?? genericAcpRuntimeAdapter;
  return adapter.sessionGoalUpdate({ update: input.update, meta: input.meta });
};

function artifactsForProviderTool(
  tool: RuntimeToolEvent,
  rules: {
    mutatingTools: ReadonlySet<string>;
    webSourceTools: ReadonlySet<string>;
  },
): RuntimeWorkspaceArtifacts {
  const standard = standardAcpArtifacts(tool);
  if (tool.status !== "completed") {
    return standard;
  }
  const toolName = normalizedToolName(tool);
  const outputFiles = rules.mutatingTools.has(toolName)
    ? extractFilePaths(tool.rawInput).filter(isDeliverableOutputPath)
    : [];
  const webSources = rules.webSourceTools.has(toolName)
    ? explicitWebFetchUrls(tool.rawInput).map(
        (uri): WorkspaceSourceRef => ({ kind: "web", uri }),
      )
    : [];
  return {
    outputs: {
      files: unique([...standard.outputs.files, ...outputFiles]),
      services: standard.outputs.services,
    },
    sources: uniqueSources([
      ...standard.sources,
      ...webSources,
    ]),
  };
}

function openCodeFamilyArtifacts(
  tool: RuntimeToolEvent,
): RuntimeWorkspaceArtifacts {
  const standard = standardAcpArtifacts(tool);
  if (tool.status !== "completed") return standard;
  const input = isRecord(tool.rawInput) ? tool.rawInput : {};
  const filePath =
    typeof input.filePath === "string" ? input.filePath : undefined;
  const files =
    tool.kind === "edit" && filePath && isDeliverableOutputPath(filePath)
      ? [filePath]
      : [];
  const sources =
    tool.kind === "fetch"
      ? explicitExternalUrls([input.url]).map(
          (uri): WorkspaceSourceRef => ({ kind: "web", uri }),
        )
      : [];
  return {
    outputs: {
      files: unique([...standard.outputs.files, ...files]),
      services: standard.outputs.services,
    },
    sources: uniqueSources([...standard.sources, ...sources]),
  };
}

function createOpenCodeFamilyRuntimeAdapter(
  provider: "opencode" | "kilo",
): AgentRuntimeAdapter {
  return {
    provider,
    matches(agentId) {
      return normalizeAgentId(agentId) === provider;
    },
    nativeAgentToolUpdates(tool, _context, logicalTool) {
      return openCodeFamilyTaskUpdates(provider, logicalTool ?? tool);
    },
    nativeAgentRawUpdates: () => [],
    nativeAgentTranscriptUpdates: () => [],
    backgroundWorkItemToolUpdates: () => [],
    planToolUpdates: openCodeFamilyPlanToolUpdates,
    sessionGoalUpdate: () => undefined,
    sessionThreadStatusUpdate: () => undefined,
    assistantNativeAgentUpdates: () => [],
    workspaceArtifacts: openCodeFamilyArtifacts,
    settleNativeAgentOnParentTurnComplete: "missing_terminal",
  };
}

function openCodeFamilyPlanToolUpdates(
  tool: RuntimeToolEvent,
): RuntimePlanUpdate[] {
  if (normalizedToolName(tool) !== "todowrite") return [];
  if (!isRecord(tool.rawInput) || !Array.isArray(tool.rawInput.todos)) {
    return [];
  }
  const entries = tool.rawInput.todos.flatMap((value) => {
    if (!isRecord(value)) return [];
    const content = stringValue(value.content);
    if (!content) return [];
    const id = stringValue(value.id);
    const status: RuntimePlanUpdate["entries"][number]["status"] =
      value.status === "pending"
      || value.status === "in_progress"
      || value.status === "completed"
      || value.status === "cancelled"
        ? value.status
        : undefined;
    const priority: RuntimePlanUpdate["entries"][number]["priority"] =
      value.priority === "high"
      || value.priority === "medium"
      || value.priority === "low"
        ? value.priority
        : undefined;
    return [{
      ...(id ? { id } : {}),
      content,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
    }];
  });
  return [{
    planId: tool.toolCallId,
    updateMode: "replace",
    entries,
  }];
}

function claudeBackgroundWorkItemUpdates(
  tool: RuntimeToolEvent,
): RuntimeWorkItemUpdate[] {
  const toolName = normalizedToolName(tool);
  const input = isRecord(tool.rawInput) ? tool.rawInput : {};
  const claudeMeta = isRecord(tool.meta?.claudeCode)
    ? tool.meta.claudeCode
    : {};
  const response = isRecord(claudeMeta.toolResponse)
    ? claudeMeta.toolResponse
    : {};

  if (toolName === "bash") {
    const backgroundTaskId = stringValue(response.backgroundTaskId);
    if (input.run_in_background !== true && !backgroundTaskId) return [];
    const provisionalId = `claude-bash:${tool.toolCallId}`;
    const command = stringValue(input.command);
    return [{
      id: backgroundTaskId ?? provisionalId,
      ...(backgroundTaskId && backgroundTaskId !== provisionalId
        ? { previousId: provisionalId }
        : {}),
      toolCallId: tool.toolCallId,
      kind: "bash",
      title: command ?? tool.title ?? "Background Bash",
      ...(command ? { command } : {}),
      status: "running",
      canStop: false,
    }];
  }

  if (toolName === "monitor" && tool.status === "completed") {
    const taskId = stringValue(response.taskId);
    if (!taskId) return [];
    const title = stringValue(input.description) ?? "Monitor";
    const command = stringValue(input.command) ?? stringValue(input.ws);
    return [{
      id: taskId,
      toolCallId: tool.toolCallId,
      kind: "monitor",
      status: "running",
      title,
      ...(command ? { command } : {}),
      canStop: false,
    }];
  }

  if (toolName === "taskstop" && tool.status === "completed") {
    const taskId = stringValue(response.task_id);
    if (!taskId) return [];
    return [{
      id: taskId,
      toolCallId: tool.toolCallId,
      kind: "other",
      status: "killed",
      reason: "task_stop",
      result: response,
    }];
  }

  return [];
}

function claudeRawBackgroundWorkItemUpdates(
  event: unknown,
): RuntimeWorkItemUpdate[] {
  const monitorDelivery = claudeRawMonitorEvents(event)[0];
  if (monitorDelivery?.monitorId) {
    return [{
      id: monitorDelivery.monitorId,
      kind: "monitor",
      phase: "classification",
      status: "running",
    }];
  }
  const message = claudeRawSdkMessage(event);
  if (!message) return [];
  if (message.type !== "system") return [];
  const taskId = stringValue(message.task_id);
  if (!taskId) return [];

  if (message.subtype === "task_progress") {
    if (stringValue(message.subagent_type)) return [];
    const description = stringValue(message.description);
    return [{
      id: taskId,
      ...(stringValue(message.tool_use_id)
        ? { toolCallId: stringValue(message.tool_use_id) }
        : {}),
      kind: "other",
      phase: "progress",
      status: "running",
      ...(description ? { title: description } : {}),
      progress: claudeTaskProgressDetails(message),
    }];
  }

  if (message.subtype === "task_started") {
    const taskType = stringValue(message.task_type)?.toLowerCase();
    const kind = taskType === "monitor" || taskType === "monitor_ws"
      ? "monitor"
      : taskType === "bash" || taskType === "shell"
        ? "bash"
        : taskType === "local_bash"
          ? "other"
        : undefined;
    if (!kind) return [];
    return [{
      id: taskId,
      ...(stringValue(message.tool_use_id)
        ? { toolCallId: stringValue(message.tool_use_id) }
        : {}),
      kind,
      status: "running",
      ...(stringValue(message.description)
        ? { title: stringValue(message.description) }
        : {}),
      canStop: false,
    }];
  }

  if (message.subtype === "task_updated" && isRecord(message.patch)) {
    const status = stringValue(message.patch.status)?.toLowerCase();
    if (status !== "completed" && status !== "failed" && status !== "killed") {
      return [];
    }
    return [{
      id: taskId,
      kind: "other",
      status,
      ...(stringValue(message.patch.description)
        ? { title: stringValue(message.patch.description) }
        : {}),
      ...(status === "failed" && stringValue(message.patch.error)
        ? { error: stringValue(message.patch.error) }
        : {}),
    }];
  }

  if (message.subtype !== "task_notification") return [];
  const status = stringValue(message.status)?.toLowerCase();
  const normalizedStatus = status === "completed"
    ? "completed"
    : status === "failed"
      ? "failed"
      : status === "stopped"
        ? "killed"
        : undefined;
  if (!normalizedStatus) return [];
  const outputFile = stringValue(message.output_file);
  const summary = stringValue(message.summary);
  const result = {
    ...(outputFile ? { output_file: outputFile } : {}),
    ...(summary ? { summary } : {}),
    ...(isRecord(message.usage) ? { usage: message.usage } : {}),
  };
  const terminal: RuntimeWorkItemUpdate = {
    id: taskId,
    kind: "other",
    status: normalizedStatus,
    ...(Object.keys(result).length > 0 ? { result } : {}),
  };
  const terminalProgress = claudeTaskProgressDetails(message);
  return terminalProgress.usage
    ? [{
        id: taskId,
        ...(stringValue(message.tool_use_id)
          ? { toolCallId: stringValue(message.tool_use_id) }
          : {}),
        kind: "other",
        phase: "progress",
        status: "running",
        progress: {
          kind: "subagent_progress",
          ...terminalProgress,
        },
      }, terminal]
    : [terminal];
}

function claudeRawNativeAgentUpdates(event: unknown): NativeAgentUpdate[] {
  const message = claudeRawSdkMessage(event);
  if (!message || message.type !== "system") return [];
  const childId = stringValue(message.task_id);
  const subagentType = stringValue(message.subagent_type);
  if (!childId || !subagentType) return [];
  const description = stringValue(message.description);
  const identity = {
    provider: "claude" as const,
    operation: "claude_agent" as const,
    ...(stringValue(message.tool_use_id)
      ? { toolCallId: stringValue(message.tool_use_id) }
      : {}),
    childId,
    ...(description ? { task: description } : {}),
    agentType: subagentType,
  };
  if (message.subtype === "task_started") {
    return [{ ...identity, status: "running" }];
  }
  if (message.subtype !== "task_progress") return [];
  return [{
    ...identity,
    progress: {
      kind: "subagent_progress",
      ...claudeTaskProgressDetails(message),
      subagentType,
    },
  }];
}

function claudeRawBackgroundWorkItemLevel(
  event: unknown,
): RuntimeBackgroundWorkItemLevel | undefined {
  const message = claudeRawSdkMessage(event);
  if (
    !message
    || message.type !== "system"
    || message.subtype !== "background_tasks_changed"
    || !Array.isArray(message.tasks)
  ) {
    return undefined;
  }
  const eventId = stringValue(message.uuid);
  if (!eventId) return undefined;
  const liveTaskIds: string[] = [];
  const liveWorkItems: RuntimeWorkItemUpdate[] = [];
  for (const task of message.tasks) {
    if (!isRecord(task)) continue;
    const taskId = stringValue(task.task_id);
    if (!taskId) continue;
    liveTaskIds.push(taskId);
    const taskType = stringValue(task.task_type)?.toLowerCase();
    if (
      taskType !== "local_bash"
      && taskType !== "local_workflow"
      && taskType !== "monitor_ws"
    ) continue;
    const description = stringValue(task.description);
    liveWorkItems.push({
      id: taskId,
      kind: taskType === "monitor_ws" ? "monitor" : "other",
      status: "running",
      ...(description ? { title: description } : {}),
      canStop: false,
    });
  }
  return {
    eventId,
    liveTaskIds,
    liveWorkItems,
  };
}

function claudeRawSdkMessage(event: unknown): Record<string, unknown> | undefined {
  if (!isRecord(event) || event.type !== "acp.extension_notification") {
    return undefined;
  }
  if (event.method !== "_claude/sdkMessage" || !isRecord(event.params)) {
    return undefined;
  }
  return isRecord(event.params.message) ? event.params.message : undefined;
}

function claudeTaskProgressDetails(
  message: Record<string, unknown>,
): Omit<NonNullable<NativeAgentUpdate["progress"]>, "kind"> {
  const description = stringValue(message.description);
  const lastToolName = stringValue(message.last_tool_name);
  const summary = stringValue(message.summary);
  const usage = isRecord(message.usage) ? message.usage : {};
  const totalTokens = finiteNumber(usage.total_tokens);
  const toolUses = finiteNumber(usage.tool_uses);
  const durationMs = finiteNumber(usage.duration_ms);
  return {
    ...(description ? { description } : {}),
    ...(lastToolName ? { lastToolName } : {}),
    ...(summary ? { summary } : {}),
    ...(totalTokens !== undefined
      && toolUses !== undefined
      && durationMs !== undefined
      ? { usage: { totalTokens, toolUses, durationMs } }
      : {}),
  };
}

function decodeXmlText(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };
  return value.replace(/&(amp|apos|gt|lt|quot);/g, (_, entity: string) => (
    entities[entity] ?? `&${entity};`
  ));
}

function claudeRawMonitorEvents(event: unknown): RuntimeMonitorEvent[] {
  if (!isRecord(event) || event.type !== "acp.extension_notification") {
    return [];
  }
  if (event.method !== "_claude/sdkMessage" || !isRecord(event.params)) {
    return [];
  }
  const message = isRecord(event.params.message) ? event.params.message : {};
  if (
    message.type !== "user"
    || !isRecord(message.origin)
    || message.origin.kind !== "task-notification"
    || !isRecord(message.message)
  ) {
    return [];
  }
  const content = typeof message.message.content === "string"
    ? message.message.content
    : Array.isArray(message.message.content)
      && message.message.content.length === 1
      && isRecord(message.message.content[0])
      && message.message.content[0].type === "text"
      ? stringValue(message.message.content[0].text)
      : undefined;
  if (!content) return [];
  const envelope = content.match(
    /^<task-notification>\r?\n([\s\S]*?)\r?\n<\/task-notification>$/,
  )?.[1];
  if (!envelope) return [];
  const monitorId = envelope.match(/<task-id>([^<\r\n]+)<\/task-id>/)?.[1];
  const description = envelope.match(
    /<summary>Monitor event: "([^"\r\n]+)"<\/summary>/,
  )?.[1];
  const text = envelope.match(/<event>([\s\S]*?)<\/event>/)?.[1];
  if (!monitorId || !description || text === undefined) return [];
  return [{
    description: decodeXmlText(description),
    text: decodeXmlText(text),
    monitorId: decodeXmlText(monitorId),
  }];
}

function codexSessionGoalUpdate(
  input: RuntimeSessionGoalInput,
): SessionGoal | null | undefined {
  // The running adapter publishes the snapshot at `_meta.goal`; the version
  // vendored under node_modules nests it under `_meta.codex.goal`. Real traffic
  // decides which one exists, so read whichever the agent actually sent rather
  // than trusting the bundled source.
  for (const scope of [input.meta, isRecord(input.meta?.codex) ? input.meta.codex : undefined]) {
    if (!scope || !Object.prototype.hasOwnProperty.call(scope, "goal")) continue;
    return normalizeSessionGoal(scope.goal);
  }
  return undefined;
}

function codexSessionThreadStatusUpdate(
  input: RuntimeSessionGoalInput,
): string | undefined {
  const codex = isRecord(input.meta?.codex) ? input.meta.codex : undefined;
  const threadStatus = isRecord(codex?.threadStatus)
    ? codex.threadStatus
    : undefined;
  return stringValue(threadStatus?.type);
}

function normalizeSessionGoal(value: unknown): SessionGoal | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const objective = stringValue(value.objective)?.trim() ?? "";
  const status = stringValue(value.status)?.trim() ?? "";
  if (!objective || !status) return undefined;

  const goal: SessionGoal = { objective, status };
  // The snapshot names its own control method (`_session/goal` today,
  // `_codex/session/goal_control` in the vendored build). Carrying it means
  // exiting a goal calls what the agent advertised instead of a method name
  // hardcoded from whichever build we happened to read.
  const controlMethod = stringValue(value.controlMethod)?.trim();
  if (controlMethod) goal.controlMethod = controlMethod;
  for (const [source, target] of [
    ["tokenBudget", "tokenBudget"],
    ["tokensUsed", "tokensUsed"],
    ["timeUsedSeconds", "timeUsedSeconds"],
  ] as const) {
    const metric = value[source];
    if (typeof metric === "number" && Number.isFinite(metric) && metric >= 0) {
      goal[target] = metric;
    }
  }
  return goal;
}

function openCodeFamilyTaskUpdates(
  provider: "opencode" | "kilo",
  tool: RuntimeToolEvent,
): NativeAgentUpdate[] {
  const input = isRecord(tool.rawInput) ? tool.rawInput : {};
  const output = isRecord(tool.rawOutput) ? tool.rawOutput : {};
  const metadata = isRecord(output.metadata) ? output.metadata : {};
  const description = stringValue(input.description);
  const prompt = stringValue(input.prompt);
  const agentType = stringValue(input.subagent_type);
  const hasNativeTaskInput =
    description !== undefined
    && prompt !== undefined
    && agentType !== undefined
    && (
      input.background === undefined
      || typeof input.background === "boolean"
    );
  if (!hasNativeTaskInput) return [];

  const hasNativeChildIdentity =
    stringValue(metadata.parentSessionId) !== undefined
    && stringValue(metadata.sessionId) !== undefined;
  if (!hasNativeChildIdentity) return [];
  const childId = stringValue(metadata.sessionId);
  const background = input.background === true || metadata.background === true;
  const structuredError = stringValue(output.error);
  const status =
    tool.status === "failed" || structuredError
      ? "error"
      : tool.status === "pending"
        || tool.status === "in_progress"
        || background
        ? "running"
        : "complete";

  return [{
    provider,
    operation: "subagent_spawn",
    toolCallId: tool.toolCallId,
    ...(childId ? { childId } : {}),
    task: description,
    agentType,
    status,
    ...(status === "error" && structuredError
      ? { errorMessage: structuredError }
      : {}),
  }];
}

function cursorTaskToolUpdates(
  tool: RuntimeToolEvent,
  context?: NativeAgentContext,
): NativeAgentUpdate[] {
  const input = isRecord(tool.rawInput) ? tool.rawInput : {};
  const toolName = stringValue(input._toolName)?.toLowerCase();
  if (toolName !== "task") return [];

  const output = isRecord(tool.rawOutput) ? tool.rawOutput : {};
  const error = stringValue(output.error);
  const status = error || tool.status === "failed"
    ? "error"
    : tool.status === "completed"
      ? "complete"
      : "running";
  return [{
    provider: "cursor",
    operation: "subagent_spawn",
    toolCallId: tool.toolCallId,
    childId: context?.childId ?? `cursor:${tool.toolCallId}`,
    ...(stringValue(input.description) ? { task: stringValue(input.description) } : {}),
    ...(cursorSubagentType(input.subagentType)
      ? { agentType: cursorSubagentType(input.subagentType) }
      : {}),
    status,
    ...(status === "error" && error ? { errorMessage: error } : {}),
  }];
}

function cursorTaskExtensionUpdates(event: unknown): NativeAgentUpdate[] {
  const record = isRecord(event) ? event : {};
  if (
    record.type !== "acp.extension_request"
    || record.method !== "cursor/task"
  ) {
    return [];
  }
  const params = isRecord(record.params) ? record.params : {};
  const toolCallId = stringValue(params.toolCallId);
  const childId = stringValue(params.agentId);
  if (!toolCallId || !childId) return [];
  const agentType = cursorSubagentType(params.subagentType);
  return [{
    provider: "cursor",
    operation: "subagent_spawn",
    toolCallId,
    childId,
    status: "running",
    ...(stringValue(params.description) ? { task: stringValue(params.description) } : {}),
    ...(agentType ? { agentType } : {}),
  }];
}

function cursorSubagentType(value: unknown): string | undefined {
  const direct = stringValue(value);
  if (direct) return direct;
  return isRecord(value) ? stringValue(value.custom) : undefined;
}

function cursorExtensionArtifacts(event: unknown): RuntimeWorkspaceArtifacts {
  const record = isRecord(event) ? event : {};
  if (
    record.type !== "acp.extension_request"
    || record.method !== "cursor/generate_image"
  ) {
    return emptyArtifacts();
  }
  const params = isRecord(record.params) ? record.params : {};
  const filePath = stringValue(params.filePath);
  const files = filePath && isDeliverableOutputPath(filePath) ? [filePath] : [];
  const sources = Array.isArray(params.referenceImagePaths)
    ? params.referenceImagePaths.flatMap((value): WorkspaceSourceRef[] => {
        const uri = stringValue(value);
        return uri ? [{ kind: "file", uri }] : [];
      })
    : [];
  return {
    outputs: { files, services: [] },
    sources: uniqueSources(sources),
  };
}

function standardAcpArtifacts(tool: RuntimeToolEvent): RuntimeWorkspaceArtifacts {
  return {
    outputs: { files: [], services: [] },
    sources: extractToolContentSources(tool),
  };
}

function normalizedToolName(tool: RuntimeToolEvent): string {
  const raw = tool.toolName ?? tool.title;
  if (typeof raw !== "string") return "";
  return normalizeToolName(raw);
}

function normalizeToolName(raw: string): string {
  const leaf = raw.trim().split(/[./:]/).pop() ?? "";
  return leaf.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeAgentId(agentId: string): string {
  return agentId.trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueSources(values: WorkspaceSourceRef[]): WorkspaceSourceRef[] {
  const seen = new Set<string>();
  return values.filter((source) => {
    const key = `${source.kind}:${source.uri}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function explicitWebFetchUrls(rawInput: unknown): string[] {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return [];
  }
  const input = rawInput as Record<string, unknown>;
  const candidates = [
    input.url,
    input.uri,
    ...(Array.isArray(input.urls) ? input.urls : []),
    ...(Array.isArray(input.uris) ? input.uris : []),
  ];
  return explicitExternalUrls(candidates);
}

function codexOpenedPageUrls(tool: RuntimeToolEvent): string[] {
  if (tool.kind !== "search" || !isRecord(tool.rawInput)) return [];
  const action = isRecord(tool.rawInput.action)
    ? tool.rawInput.action
    : undefined;
  if (
    !action
    || (action.type !== "openPage" && action.type !== "findInPage")
    || typeof action.url !== "string"
  ) {
    return [];
  }
  return explicitExternalUrls([action.url]);
}

function codexGeneratedMediaPaths(tool: RuntimeToolEvent): string[] {
  const toolName = normalizedToolName(tool);
  if (toolName !== "imagegeneration" || !isRecord(tool.rawOutput)) return [];
  const savedPath = tool.rawOutput.savedPath;
  return typeof savedPath === "string" && isDeliverableOutputPath(savedPath)
    ? [savedPath]
    : [];
}

function explicitExternalUrls(candidates: unknown[]): string[] {
  return unique(candidates.filter(
    (candidate): candidate is string =>
      typeof candidate === "string"
      && /^https?:\/\//i.test(candidate)
      && !isLocalServiceUrl(candidate),
  ));
}

function emptyArtifacts(): RuntimeWorkspaceArtifacts {
  return {
    outputs: { files: [], services: [] },
    sources: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isLocalServiceUrl(uri: string): boolean {
  try {
    const host = new URL(uri).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  } catch {
    return false;
  }
}
