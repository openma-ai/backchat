/**
 * Reduce an array of ACP `session.event` payloads into the bubble structure
 * the chat view renders.
 *
 *   - `agent_message_chunk` (type=text) → concatenated into a single
 *     assistant bubble (one per turn).
 *   - `agent_thought_chunk` (type=text) → concatenated into an optional
 *     "Thinking" reasoning block above the assistant bubble.
 *   - `tool_call` → a new `ToolEntry` with status/title/etc, content[]
 *     blocks (diff / terminal / image / content), and locations[].
 *   - `tool_call_update` → PATCH onto an existing tool by toolCallId.
 *   - `plan`             → REPLACE the current plan (no merging).
 *   - `available_commands_update` → REPLACE the per-session slash command
 *     list. The session store, not reduceTurn, owns this — it's
 *     session-scoped, not turn-scoped — but we surface it here so the
 *     reducer test can verify the dispatch path.
 *   - `current_mode_update` → REPLACE the agent's current mode id.
 *   - everything else    → drop quietly; usage_update etc. are next.
 *
 * Designed to be pure: pass an immutable event list, get a snapshot.
 * Re-running on each render is cheap because events list grows linearly
 * with the turn length (a few hundred at most).
 */

export interface ChunkText {
  text: string;
}

export interface ToolEntry {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: "pending" | "in_progress" | "completed" | "failed" | string;
  rawInput?: unknown;
  rawOutput?: unknown;
  toolName?: string;
  /** Vendor/implementation extension data carried by ACP `_meta`. ACP
   *  explicitly reserves this shape for custom protocol details. */
  meta?: Record<string, unknown>;
  /** Known vendor extension used by claude-agent-acp to associate subagent
   *  child tool calls with the parent Task/Agent tool use. */
  parentToolUseId?: string;
  /** ACP tool content blocks. Each block is one of:
   *    { type: "content", content: { type: "text" | "image" | ..., ... } }
   *    { type: "diff", path, oldText, newText }
   *    { type: "terminal", terminalId }
   *  Patch semantics on tool_call_update: when content arrives in an
   *  update, REPLACE the array (matches Zed's reference client). */
  content?: ToolContentBlock[];
  /** Files / URLs the tool touched. Renderer turns these into clickable
   *  links above the disclosure. */
  locations?: Array<{ path?: string; line?: number }>;
}

export type ToolContentBlock =
  | { type: "content"; content?: { type?: string; text?: string; uri?: string; mimeType?: string; data?: string } }
  | { type: "diff"; path?: string; oldText?: string; newText?: string }
  | { type: "terminal"; terminalId?: string };

export interface PlanEntry {
  content: string;
  status?: "pending" | "in_progress" | "completed";
  priority?: "high" | "medium" | "low";
}

export type TimelineItem =
  | {
      /** Continuous block of assistant text — concatenated agent_message_chunk
       *  events that arrived without being interrupted by a tool_call. The
       *  next tool_call starts a new segment. */
      kind: "assistant_text";
      text: string;
    }
  | {
      /** Pointer to a ToolEntry; the renderer looks the entry up in `tools`
       *  by id rather than embedding it inline so tool_call_update events
       *  that PATCH the tool still flow through. */
      kind: "tool";
      toolCallId: string;
    };

export interface TurnRender {
  thoughtText: string;
  assistantText: string;
  tools: ToolEntry[];
  plan: PlanEntry[];
  /** Synthetic events the runtime emits in addition to ACP — e.g. the
   *  "requestPermission" pause marker. Phase 6 renders these as modals;
   *  Phase 3 just shows them inline as muted lines. */
  notes: string[];
  /** Time-ordered list of "what to render between thought and assistant
   *  tail". Assistant message chunks and tool_calls interleave in the
   *  ACP stream — agents say "I'll look at X", call read_text_file,
   *  then say "now I'll edit Y" and call write_text_file. Lumping all
   *  text after all tools (the old behavior) reads as "did a bunch of
   *  things, then explained". This list preserves the order. */
  timeline: TimelineItem[];
}

interface AcpContentText {
  type?: string;
  text?: string;
}

interface ChunkPayload {
  sessionUpdate?: string;
  content?: AcpContentText;
}

interface ToolCallPayload {
  sessionUpdate?: string;
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: ToolEntry["status"];
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolContentBlock[];
  locations?: ToolEntry["locations"];
}

interface PlanPayload {
  sessionUpdate?: string;
  entries?: PlanEntry[];
}

export interface AvailableCommand {
  name: string;
  description?: string;
  input?: { hint?: string } | null;
}

export type ParsedAcpEvent =
  | { kind: "text"; text: string; event: unknown }
  | { kind: "thought"; text: string; event: unknown }
  | { kind: "tool_call"; tool: Partial<ToolEntry> & { toolCallId: string }; event: unknown }
  | { kind: "commands"; commands: AvailableCommand[]; event: unknown }
  | { kind: "plan"; plan: PlanEntry[]; event: unknown }
  | { kind: "note"; note: string; event: unknown }
  | { kind: "silent"; event: unknown }
  | { kind: "raw"; event: unknown };

const SILENT_SESSION_UPDATES = new Set([
  "current_mode_update",
  "config_option_update",
  "session_info_update",
  "usage_update",
]);

const ACP_SESSION_UPDATE_TYPES = new Set([
  "user_message_chunk",
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
  "plan",
  "plan_update",
  "plan_removed",
  "available_commands_update",
  ...SILENT_SESSION_UPDATES,
]);

export function sessionUpdateInner(event: unknown): Record<string, unknown> {
  const ev = event as
    | { update?: Record<string, unknown>; sessionUpdate?: string }
    | null
    | undefined;
  const update = ev?.update;
  return (update && typeof update === "object" ? update : ev ?? {}) as Record<
    string,
    unknown
  >;
}

export function sessionUpdateType(event: unknown): string | undefined {
  const inner = sessionUpdateInner(event);
  const ev = event as { sessionUpdate?: unknown } | null | undefined;
  const rawType = typeof inner.type === "string" ? inner.type : undefined;
  const innerUpdate =
    typeof inner.sessionUpdate === "string" ? inner.sessionUpdate : undefined;
  const outerUpdate =
    typeof ev?.sessionUpdate === "string" ? ev.sessionUpdate : undefined;
  return (
    innerUpdate ??
    outerUpdate ??
    (rawType && ACP_SESSION_UPDATE_TYPES.has(rawType) ? rawType : undefined)
  );
}

function stringField(raw: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = raw[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function normalizeToolCall(
  raw: Record<string, unknown>,
): Partial<ToolEntry> & { toolCallId: string } {
  const meta = objectField(raw._meta);
  const claudeMeta = objectField(meta.claudeCode);
  const toolCallId = raw.toolCallId ?? raw.tool_call_id ?? raw.id;
  const entry: Partial<ToolEntry> & { toolCallId: string } = {
    toolCallId: String(toolCallId ?? ""),
  };
  if (Object.keys(meta).length > 0) entry.meta = meta;
  const title = raw.title ?? raw.name ?? raw.toolName ?? raw.tool_name;
  if (typeof title === "string") entry.title = title;
  if (typeof raw.kind === "string") entry.kind = raw.kind;
  if (typeof raw.status === "string") entry.status = raw.status;
  const rawInput = raw.rawInput ?? raw.raw_input ?? raw.input ?? raw.args;
  const rawOutput = raw.rawOutput ?? raw.raw_output ?? raw.output ?? raw.result;
  if (rawInput !== undefined && rawInput !== null) entry.rawInput = rawInput;
  if (rawOutput !== undefined && rawOutput !== null) entry.rawOutput = rawOutput;
  if (Array.isArray(raw.content)) entry.content = raw.content as ToolContentBlock[];
  if (Array.isArray(raw.locations)) entry.locations = raw.locations as ToolEntry["locations"];
  const toolName = claudeMeta.toolName ?? raw.toolName ?? raw.tool_name ?? raw.name;
  if (typeof toolName === "string") entry.toolName = toolName;
  const parentToolUseId =
    stringValue(claudeMeta.parentToolUseId) ??
    stringValue(raw.parentToolUseId) ??
    stringValue(raw.parent_tool_use_id);
  if (parentToolUseId) entry.parentToolUseId = parentToolUseId;
  return entry;
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizePermissionRequest(raw: Record<string, unknown>, event: unknown): ParsedAcpEvent {
  const params = raw.params && typeof raw.params === "object"
    ? (raw.params as Record<string, unknown>)
    : raw;
  const toolCall = params.toolCall && typeof params.toolCall === "object"
    ? (params.toolCall as Record<string, unknown>)
    : null;
  const id =
    toolCall?.toolCallId ??
    toolCall?.tool_call_id ??
    params.toolCallId ??
    params.tool_call_id ??
    params.id ??
    params.permissionId ??
    params.permission_id ??
    "request";
  const title =
    toolCall?.title ??
    params.title ??
    params.name ??
    params.toolName ??
    params.tool_name ??
    "Permission request";
  return {
    kind: "tool_call",
    tool: {
      toolCallId: `permission-${String(id)}`,
      title: String(title),
      kind: typeof toolCall?.kind === "string" ? toolCall.kind : "permission",
      status: "pending",
      rawInput: toolCall?.rawInput ?? toolCall?.raw_input ?? params,
      ...(Array.isArray(toolCall?.locations)
        ? { locations: toolCall.locations as ToolEntry["locations"] }
        : {}),
    },
    event,
  };
}

function extractContentText(inner: Record<string, unknown>): string | undefined {
  if (typeof inner.text === "string") return inner.text;
  if (typeof inner.delta === "string") return inner.delta;
  if (typeof inner.content === "string") return inner.content;
  const content = inner.content as
    | { type?: string; text?: string; content?: unknown }
    | undefined;
  if (typeof content?.text === "string") return content.text;
  if (typeof content?.content === "string") return content.content;
  if (content?.content && typeof content.content === "object") {
    const nested = content.content as { text?: string };
    if (typeof nested.text === "string") return nested.text;
  }
  return undefined;
}

function extractTextBlocks(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const block = part as { text?: unknown; content?: unknown };
        if (typeof block.text === "string") return block.text;
        if (typeof block.content === "string") return block.content;
        return "";
      })
      .join("");
    return text.length > 0 ? text : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const block = value as { text?: unknown; content?: unknown };
  if (typeof block.text === "string") return block.text;
  if (typeof block.content === "string") return block.content;
  return undefined;
}

function isTransportDiagnosticText(text: string): boolean {
  return /^Falling back from WebSockets to HTTPS transport\./i.test(text.trim());
}

export function sanitizeThoughtText(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function parsePlanEntries(rawEntries: unknown): PlanEntry[] {
  if (!Array.isArray(rawEntries)) return [];
  return rawEntries
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      content: typeof entry.content === "string" ? entry.content : "",
      priority:
        entry.priority === "high" ||
        entry.priority === "medium" ||
        entry.priority === "low"
          ? entry.priority
          : undefined,
      status:
        entry.status === "pending" ||
        entry.status === "in_progress" ||
        entry.status === "completed"
          ? entry.status
          : "pending",
    }));
}

function getEventSummary(event: Record<string, unknown>): string | undefined {
  try {
    return JSON.stringify(event);
  } catch {
    return undefined;
  }
}

export function parseAcpEvent(event: unknown): ParsedAcpEvent {
  const inner = sessionUpdateInner(event);
  const update = sessionUpdateType(event);

  if (!update) {
    if (inner.type === "agent.message_chunk" && typeof inner.delta === "string") {
      return inner.delta.length > 0
        ? { kind: "text", text: inner.delta, event }
        : { kind: "silent", event };
    }
    if (inner.type === "agent.message") {
      const text = extractTextBlocks(inner.content);
      return typeof text === "string" && text.length > 0
        ? { kind: "text", text, event }
        : { kind: "silent", event };
    }
    if (inner.type === "agent.thinking_chunk" && typeof inner.delta === "string") {
      const text = sanitizeThoughtText(inner.delta);
      return inner.delta.length > 0
        ? text.length > 0
          ? { kind: "thought", text, event }
          : { kind: "silent", event }
        : { kind: "silent", event };
    }
    if (inner.type === "agent.thinking") {
      const rawText = typeof inner.text === "string" ? inner.text : extractTextBlocks(inner.content);
      const text = typeof rawText === "string" ? sanitizeThoughtText(rawText) : rawText;
      return typeof text === "string" && text.length > 0
        ? { kind: "thought", text, event }
        : { kind: "silent", event };
    }
    if (inner.type === "agent.tool_use" && typeof inner.id === "string") {
      return {
        kind: "tool_call",
        tool: {
          toolCallId: inner.id,
          title: typeof inner.name === "string" ? inner.name : "tool",
          toolName: typeof inner.name === "string" ? inner.name : undefined,
          rawInput: inner.input ?? {},
          status: "pending",
        },
        event,
      };
    }
    if (inner.type === "agent.tool_result" && typeof inner.tool_use_id === "string") {
      return {
        kind: "tool_call",
        tool: {
          toolCallId: inner.tool_use_id,
          rawOutput: extractTextBlocks(inner.content) ?? inner.content,
          status: inner.is_error ? "failed" : "completed",
        },
        event,
      };
    }
    if (
      inner.type === "agent.message_stream_start" ||
      inner.type === "agent.message_stream_end" ||
      inner.type === "agent.thinking_stream_start" ||
      inner.type === "agent.thinking_stream_end" ||
      inner.type === "agent.tool_use_input_stream_start" ||
      inner.type === "agent.tool_use_input_chunk" ||
      inner.type === "agent.tool_use_input_stream_end" ||
      inner.type === "session.status_running" ||
      inner.type === "session.status_idle" ||
      inner.type === "session.warning"
    ) {
      return { kind: "silent", event };
    }
    if (inner.type === "session.error" && typeof inner.error === "string" && inner.error.length > 0) {
      return { kind: "note", note: inner.error, event };
    }
    if (inner.type === "text" && typeof inner.text === "string" && inner.text.length > 0) {
      return { kind: "text", text: inner.text, event };
    }
    if (inner.type === "thought" && typeof inner.text === "string" && inner.text.length > 0) {
      const text = sanitizeThoughtText(inner.text);
      return text.length > 0
        ? { kind: "thought", text, event }
        : { kind: "silent", event };
    }
    if (inner.type === "requestPermission") {
      return normalizePermissionRequest(inner, event);
    }
    if (
      (inner.type === "tool_call" || inner.type === "tool_call_update") &&
      (typeof inner.toolCallId === "string" ||
        typeof inner.tool_call_id === "string" ||
        typeof inner.id === "string")
    ) {
      return { kind: "tool_call", tool: normalizeToolCall(inner), event };
    }
    if (inner.type === "promptError" && typeof inner.error === "string" && inner.error.length > 0) {
      return { kind: "text", text: inner.error, event };
    }
    if (inner.type === "promptComplete") {
      return { kind: "note", note: "Turn complete", event };
    }
    return { kind: "raw", event };
  }

  if (update === "agent_message_chunk" || update === "agent_thought_chunk") {
    const text = extractContentText(inner);
    if (typeof text !== "string" || text.length === 0) return { kind: "silent", event };
    if (update === "agent_message_chunk" && isTransportDiagnosticText(text)) {
      return { kind: "silent", event };
    }
    const visibleText = update === "agent_thought_chunk" ? sanitizeThoughtText(text) : text;
    if (visibleText.length === 0) return { kind: "silent", event };
    return {
      kind: update === "agent_thought_chunk" ? "thought" : "text",
      text: visibleText,
      event,
    };
  }

  if (update === "user_message_chunk") return { kind: "silent", event };

  if (update === "tool_call" || update === "tool_call_update") {
    const toolCallId = stringField(inner, ["toolCallId", "tool_call_id", "id"]);
    if (!toolCallId) return { kind: "raw", event };
    return { kind: "tool_call", tool: normalizeToolCall(inner), event };
  }

  if (update === "plan") {
    const rawEntries = Array.isArray(inner.entries)
      ? inner.entries
      : inner.plan &&
          typeof inner.plan === "object" &&
          Array.isArray((inner.plan as { entries?: unknown }).entries)
        ? (inner.plan as { entries: unknown[] }).entries
        : [];
    return { kind: "plan", plan: parsePlanEntries(rawEntries), event };
  }

  if (update === "plan_update") {
    const plan = inner.plan && typeof inner.plan === "object"
      ? (inner.plan as Record<string, unknown>)
      : inner;
    const content = plan.content && typeof plan.content === "object"
      ? (plan.content as Record<string, unknown>)
      : plan;
    if (Array.isArray(content.entries)) {
      return { kind: "plan", plan: parsePlanEntries(content.entries), event };
    }
    const markdown =
      typeof content.markdown === "string"
        ? content.markdown
        : typeof content.content === "string"
          ? content.content
          : undefined;
    if (markdown) {
      return {
        kind: "plan",
        plan: [{ content: markdown, status: "in_progress" }],
        event,
      };
    }
    const summary = getEventSummary(inner);
    return {
      kind: "note",
      note: summary ? `Plan updated: ${summary}` : "Plan updated",
      event,
    };
  }

  if (update === "plan_removed") {
    return {
      kind: "note",
      note: typeof inner.id === "string" ? `Plan removed: ${inner.id}` : "Plan removed",
      event,
    };
  }

  if (update === "available_commands_update") {
    const availableCommands = Array.isArray(inner.availableCommands)
      ? inner.availableCommands
      : Array.isArray(inner.available_commands)
        ? inner.available_commands
        : null;
    if (!availableCommands) return { kind: "silent", event };
    return {
      kind: "commands",
      commands: availableCommands as AvailableCommand[],
      event,
    };
  }

  if (SILENT_SESSION_UPDATES.has(update)) return { kind: "silent", event };
  return { kind: "raw", event };
}

function isEmptyObject(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  return Object.keys(value as Record<string, unknown>).length === 0;
}

const MIN_OVERLAP = 8;
const SNAPSHOT_HEAD_PROBE = 16;

export function mergeStreamingText(accumulated: string, incoming: string): string {
  if (!accumulated) return incoming;
  if (!incoming) return accumulated;
  if (incoming === accumulated) return accumulated;
  if (incoming.startsWith(accumulated)) return incoming;
  if (accumulated.endsWith(incoming)) return accumulated;
  if (incoming.length >= accumulated.length) {
    const head = Math.min(SNAPSHOT_HEAD_PROBE, accumulated.length);
    if (head > 0 && incoming.slice(0, head) === accumulated.slice(0, head)) {
      return incoming;
    }
  }
  const maxOverlap = Math.min(accumulated.length, incoming.length);
  for (let k = maxOverlap; k >= MIN_OVERLAP; k--) {
    if (accumulated.endsWith(incoming.slice(0, k))) {
      return accumulated + incoming.slice(k);
    }
  }
  return accumulated + incoming;
}

export function reduceTurn(events: readonly { payload: unknown }[]): TurnRender {
  const out: TurnRender = {
    thoughtText: "",
    assistantText: "",
    tools: [],
    plan: [],
    notes: [],
    timeline: [],
  };
  const toolById = new Map<string, ToolEntry>();
  let toolsOrder: string[] = [];
  // Running buffer for the current assistant_text segment. Flushed into
  // out.timeline when a tool_call event arrives (which breaks the run)
  // or at end-of-stream. Same chunk concatenation we used to do into
  // assistantText, but segment-aware.
  let textBuf = "";
  const flushText = () => {
    if (textBuf) {
      out.timeline.push({ kind: "assistant_text", text: textBuf });
      textBuf = "";
    }
  };
  const upsertTool = (incoming: Partial<ToolEntry> & { toolCallId: string }) => {
    const id = incoming.toolCallId;
    if (!id) return;
    const prev = toolById.get(id);
    if (!prev) {
      const entry: ToolEntry = {
        toolCallId: id,
        title: incoming.title,
        kind: incoming.kind,
        status: incoming.status,
        rawInput: incoming.rawInput,
        rawOutput: incoming.rawOutput,
        toolName: incoming.toolName,
        meta: incoming.meta,
        parentToolUseId: incoming.parentToolUseId,
        content: incoming.content,
        locations: incoming.locations,
      };
      if (
        entry.status === "in_progress" &&
        entry.content?.some((b) => b.type === "content" && b.content?.type === "image")
      ) {
        entry.status = "completed";
      }
      toolById.set(id, entry);
      if (!toolsOrder.includes(id)) {
        toolsOrder.push(id);
        flushText();
        out.timeline.push({ kind: "tool", toolCallId: id });
      }
      return;
    }

    if (incoming.title !== undefined) prev.title = incoming.title;
    if (incoming.kind !== undefined) prev.kind = incoming.kind;
    if (incoming.status !== undefined) prev.status = incoming.status;
    if (incoming.toolName !== undefined) prev.toolName = incoming.toolName;
    if (incoming.meta !== undefined) {
      prev.meta = {
        ...(prev.meta ?? {}),
        ...incoming.meta,
      };
    }
    if (incoming.parentToolUseId !== undefined) {
      prev.parentToolUseId = incoming.parentToolUseId;
    }
    if (incoming.rawInput !== undefined) {
      const incEmpty = isEmptyObject(incoming.rawInput);
      const prevHasContent = !isEmptyObject(prev.rawInput);
      if (!(incEmpty && prevHasContent)) prev.rawInput = incoming.rawInput;
    }
    if (incoming.rawOutput !== undefined) prev.rawOutput = incoming.rawOutput;
    if (incoming.content !== undefined) prev.content = incoming.content;
    if (incoming.locations !== undefined) prev.locations = incoming.locations;
    if (
      prev.status === "in_progress" &&
      prev.content?.some((b) => b.type === "content" && b.content?.type === "image")
    ) {
      prev.status = "completed";
    }
  };

  for (const ev of events) {
    const parsed = parseAcpEvent(ev.payload);
    switch (parsed.kind) {
      case "thought":
        out.thoughtText = mergeStreamingText(out.thoughtText, parsed.text);
        break;
      case "text":
        textBuf = mergeStreamingText(textBuf, parsed.text);
        break;
      case "tool_call":
        upsertTool(parsed.tool);
        break;
      case "plan":
        out.plan = parsed.plan;
        break;
      case "note":
        out.notes.push(parsed.note);
        break;
      case "commands":
      case "silent":
        break;
      case "raw":
        // Drop raw events from the primary chat surface. They are still
        // available in the persisted event stream for debugging.
        break;
    }
  }
  // Flush any trailing assistant text so the closing message segment
  // makes it into the timeline.
  flushText();

  out.tools = toolsOrder
    .map((id) => toolById.get(id))
    .filter((e): e is ToolEntry => !!e);
  // For back-compat with code still reading TurnRender.assistantText —
  // the streaming track and a few legacy spots — concatenate the segments.
  out.assistantText = out.timeline
    .filter((t): t is Extract<TimelineItem, { kind: "assistant_text" }> =>
      t.kind === "assistant_text",
    )
    .map((t) => t.text)
    .join("");
  return out;
}
