import type { PersistedEvent } from "./sql-store.js";

export interface SessionHistoryToolSession {
  id: string;
  title: string;
  agent_id: string;
  cwd: string;
}

export interface SessionHistoryToolReadOptions {
  after_seq?: number;
  max_chars?: number;
  include_activity?: boolean;
}

export interface SessionHistoryToolReadResult {
  session: SessionHistoryToolSession;
  from_seq: number;
  next_after_seq: number;
  has_more: boolean;
  content: string;
}

export function formatSessionHistory(
  session: SessionHistoryToolSession,
  events: readonly PersistedEvent[],
  options: SessionHistoryToolReadOptions = {},
): SessionHistoryToolReadResult {
  const fromSeq = Math.max(0, options.after_seq ?? 0);
  const maxChars = Math.max(1_000, Math.min(100_000, options.max_chars ?? 30_000));
  const includeActivity = options.include_activity === true;
  const selected = events.filter((event) => event.seq > fromSeq);
  const blocks: string[] = [];
  let lastSeq = fromSeq;
  let currentAssistant = "";

  const flushAssistant = () => {
    if (!currentAssistant) return;
    blocks.push(`## Assistant\n${currentAssistant.trim()}`);
    currentAssistant = "";
  };

  for (const event of selected) {
    const previousBlockCount = blocks.length;
    const previousAssistant = currentAssistant;
    const data = parseRecord(event.data);
    if (event.type === "user_prompt") {
      flushAssistant();
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (text) blocks.push(`## User\n${text}`);
    } else if (event.type === "agent_message" || event.type === "agent_message_chunk") {
      const text = eventText(data);
      if (text) currentAssistant += text;
    } else if (includeActivity && (event.type === "agent_thought" || event.type === "agent_thought_chunk")) {
      flushAssistant();
      const text = eventText(data);
      if (text) blocks.push(`### Agent thought\n${text.trim()}`);
    } else if (includeActivity && (event.type === "tool_call" || event.type === "tool_call_update")) {
      flushAssistant();
      const title = typeof data.title === "string" ? data.title : event.type;
      blocks.push(`### Activity\n${title}`);
    }

    const candidate = renderSessionHistory(session, blocks, currentAssistant);
    if (candidate.length > maxChars) {
      blocks.length = previousBlockCount;
      currentAssistant = previousAssistant;
      return {
        session,
        from_seq: fromSeq,
        next_after_seq: lastSeq,
        has_more: true,
        content: renderSessionHistory(session, blocks, currentAssistant),
      };
    }
    lastSeq = event.seq;
  }

  const previousBlockCount = blocks.length;
  const previousAssistant = currentAssistant;
  flushAssistant();
  const content = renderSessionHistory(session, blocks, currentAssistant);
  if (content.length > maxChars) {
    blocks.length = previousBlockCount;
    currentAssistant = previousAssistant;
    return {
      session,
      from_seq: fromSeq,
      next_after_seq: lastSeq,
      has_more: true,
      content: renderSessionHistory(session, blocks, currentAssistant),
    };
  }
  return {
    session,
    from_seq: fromSeq,
    next_after_seq: selected.at(-1)?.seq ?? fromSeq,
    has_more: false,
    content,
  };
}

function renderSessionHistory(
  session: SessionHistoryToolSession,
  blocks: readonly string[],
  currentAssistant: string,
): string {
  const pending = currentAssistant ? [`## Assistant\n${currentAssistant.trim()}`] : [];
  const body = [...blocks, ...pending].join("\n\n");
  return [
    `# ${session.title || session.id}`,
    `- session_id: ${session.id}`,
    `- agent: ${session.agent_id}`,
    `- workspace: ${session.cwd}`,
    "",
    body || "(No readable conversation messages.)",
  ].join("\n");
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function eventText(data: Record<string, unknown>): string {
  const content = data.content;
  if (!content || typeof content !== "object") return "";
  const text = (content as Record<string, unknown>).text;
  return typeof text === "string" ? text : "";
}
