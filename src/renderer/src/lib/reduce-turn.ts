/**
 * Reduce an array of ACP `session.event` payloads into the bubble structure
 * the chat view renders.
 *
 *   - `agent_message_chunk` (type=text) → concatenated into a single
 *     assistant bubble (one per turn).
 *   - `agent_thought_chunk` (type=text) → concatenated into an optional
 *     "Thinking" reasoning block above the assistant bubble.
 *   - `tool_call` → a new `ToolEntry` with status/title/etc.
 *   - `tool_call_update` → PATCH onto an existing tool by toolCallId.
 *   - `plan`             → REPLACE the current plan (no merging).
 *   - everything else    → drop quietly for now; Phase 5 will render
 *                          available_commands_update / usage_update / etc.
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
}

export interface PlanEntry {
  content: string;
  status?: "pending" | "in_progress" | "completed";
  priority?: "high" | "medium" | "low";
}

export interface TurnRender {
  thoughtText: string;
  assistantText: string;
  tools: ToolEntry[];
  plan: PlanEntry[];
  /** Synthetic events the runtime emits in addition to ACP — e.g. the
   *  "requestPermission" pause marker. Phase 6 renders these as modals;
   *  Phase 3 just shows them inline as muted lines. */
  notes: string[];
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
  };
  const toolById = new Map<string, ToolEntry>();
  let toolsOrder: string[] = [];

  for (const ev of events) {
    const p = ev.payload as ChunkPayload & ToolCallPayload & PlanPayload &
      { type?: string; params?: unknown; error?: string };
    const kind = p?.sessionUpdate ?? p?.type;
    switch (kind) {
      // assistant + thought chunks are intentionally NOT accumulated here.
      // Phase 5.1 routes them through the dedicated stream channel into
      // <StreamingMarkdown>, which mutates the DOM directly and never goes
      // through React. Re-deriving them on every render would re-introduce
      // the O(N) per-frame work this whole architecture exists to avoid.
      // The accumulated strings live on Turn.assistantText / .thoughtText
      // for the post-stream Streamdown render.
      case "agent_message_chunk":
      case "agent_thought_chunk":
        break;
      case "tool_call": {
        const id = (p as ToolCallPayload).toolCallId;
        if (!id) break;
        const entry: ToolEntry = {
          toolCallId: id,
          title: p.title,
          kind: p.kind,
          status: p.status,
          rawInput: p.rawInput,
          rawOutput: p.rawOutput,
        };
        toolById.set(id, entry);
        if (!toolsOrder.includes(id)) toolsOrder.push(id);
        break;
      }
      case "tool_call_update": {
        const id = (p as ToolCallPayload).toolCallId;
        if (!id) break;
        const prev = toolById.get(id);
        if (!prev) {
          // Update before the original tool_call — materialize from
          // whatever we have so the entry isn't lost.
          toolById.set(id, {
            toolCallId: id,
            title: p.title,
            kind: p.kind,
            status: p.status,
            rawInput: p.rawInput,
            rawOutput: p.rawOutput,
          });
          if (!toolsOrder.includes(id)) toolsOrder.push(id);
          break;
        }
        // PATCH semantics — only overwrite fields that arrived.
        if (p.title !== undefined) prev.title = p.title;
        if (p.kind !== undefined) prev.kind = p.kind;
        if (p.status !== undefined) prev.status = p.status;
        if (p.rawInput !== undefined) prev.rawInput = p.rawInput;
        if (p.rawOutput !== undefined) prev.rawOutput = p.rawOutput;
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

  out.tools = toolsOrder
    .map((id) => toolById.get(id))
    .filter((e): e is ToolEntry => !!e);
  return out;
}
