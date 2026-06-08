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
  status?: "pending" | "in_progress" | "completed" | "failed";
  rawInput?: unknown;
  rawOutput?: unknown;
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

  for (const ev of events) {
    const p = ev.payload as ChunkPayload & ToolCallPayload & PlanPayload &
      { type?: string; params?: unknown; error?: string };
    const kind = p?.sessionUpdate ?? p?.type;
    switch (kind) {
      // Thought chunks are intentionally NOT accumulated here — Phase 5.1
      // routes them through the dedicated stream channel into
      // <StreamingMarkdown>; the accumulated string lives on
      // Turn.thoughtText for the post-stream Streamdown render.
      case "agent_thought_chunk":
        break;
      // Assistant message chunks: keep contributing to the running
      // timeline segment. The chunk's text is duplicated on Turn.assistantText
      // (store-managed) for the streaming track and on textBuf (here) for
      // the segment-aware post-stream render — both paths read different
      // shapes of the same data.
      case "agent_message_chunk": {
        const c = (p as ChunkPayload).content;
        if (c?.type === "text" && typeof c.text === "string") {
          textBuf += c.text;
        }
        break;
      }
      case "tool_call": {
        const id = (p as ToolCallPayload).toolCallId;
        if (!id) break;
        // A tool_call breaks the current assistant_text run — flush it
        // before pushing the tool into the timeline so order is preserved.
        flushText();
        const entry: ToolEntry = {
          toolCallId: id,
          title: p.title,
          kind: p.kind,
          status: p.status,
          rawInput: p.rawInput,
          rawOutput: p.rawOutput,
          content: p.content,
          locations: p.locations,
        };
        toolById.set(id, entry);
        if (!toolsOrder.includes(id)) {
          toolsOrder.push(id);
          out.timeline.push({ kind: "tool", toolCallId: id });
        }
        break;
      }
      case "tool_call_update": {
        const id = (p as ToolCallPayload).toolCallId;
        if (!id) break;
        const prev = toolById.get(id);
        if (!prev) {
          // Update before the original tool_call — materialize from
          // whatever we have so the entry isn't lost.
          const entry: ToolEntry = {
            toolCallId: id,
            title: p.title,
            kind: p.kind,
            status: p.status,
            rawInput: p.rawInput,
            rawOutput: p.rawOutput,
            content: p.content,
            locations: p.locations,
          };
          if (
            entry.status === "in_progress" &&
            entry.content?.some(
              (b) => b.type === "content" && b.content?.type === "image",
            )
          ) {
            entry.status = "completed";
          }
          toolById.set(id, entry);
          if (!toolsOrder.includes(id)) {
            toolsOrder.push(id);
            // tool_call_update arriving first is rare but if it does we
            // still flush text so order is preserved.
            flushText();
            out.timeline.push({ kind: "tool", toolCallId: id });
          }
          break;
        }
        // PATCH semantics — only overwrite fields that arrived. content
        // and locations replace the whole array (Zed reference client
        // behavior — agents send the cumulative list each update).
        if (p.title !== undefined) prev.title = p.title;
        if (p.kind !== undefined) prev.kind = p.kind;
        if (p.status !== undefined) prev.status = p.status;
        if (p.rawInput !== undefined) prev.rawInput = p.rawInput;
        if (p.rawOutput !== undefined) prev.rawOutput = p.rawOutput;
        if (p.content !== undefined) prev.content = p.content;
        if (p.locations !== undefined) prev.locations = p.locations;
        // Tool call `close` fallback. codex-acp 0.15.0 (and OpenAI's
        // backend that feeds it via rust-v0.133.0) emit the End event
        // for image generation with `status: "generating"` — the API
        // chunk arrives before the model-side aggregation flips it to
        // `"completed"`, so we get stuck showing "调用中" forever on
        // a row that already has the image bytes attached. If a tool
        // now carries an image content block, treat that as the
        // completion signal — the actual bytes are right there.
        if (
          prev.status === "in_progress" &&
          prev.content?.some(
            (b) => b.type === "content" && b.content?.type === "image",
          )
        ) {
          prev.status = "completed";
        }
        break;
      }
      case "plan": {
        out.plan = (p as PlanPayload).entries ?? [];
        break;
      }
      case "requestPermission": {
        out.notes.push(
          `permission requested${p.params ? " (deciding…)" : ""}`,
        );
        break;
      }
      case "requestPermissionError": {
        out.notes.push(`permission error: ${p.error ?? "unknown"}`);
        break;
      }
      default:
        // Drop — Phase 5 will surface these.
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
