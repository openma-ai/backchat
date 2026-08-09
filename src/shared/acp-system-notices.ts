import {
  extractAcpSystemNotice as extractCommonAcpSystemNotice,
  type AcpSystemNotice,
} from "@openma/common/session-events/acp";

export type { AcpSystemNotice };

const CODEX_SKILL_CONTEXT_WARNING =
  /^Warning:\s*Skill descriptions were shortened to fit the (?:\d+%\s+)?skills context budget\./;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function splitAcpSystemNoticeText(text: string): {
  notice?: string;
  transcript: string;
} {
  const candidate = text.trimStart();
  if (!CODEX_SKILL_CONTEXT_WARNING.test(candidate)) {
    return { transcript: text };
  }
  const paragraphBreak = candidate.search(/\r?\n[\t ]*\r?\n/);
  if (paragraphBreak < 0) {
    return { notice: candidate.trim(), transcript: "" };
  }
  const separator = candidate.slice(paragraphBreak).match(/^\r?\n[\t ]*\r?\n/)?.[0]
    ?? "";
  return {
    notice: candidate.slice(0, paragraphBreak).trim(),
    transcript: candidate.slice(paragraphBreak + separator.length).trimStart(),
  };
}

/** Preserve the common Codex warning classifier, accept the provider variant
 * that omits its percentage, and add Pi's structured warning signal. */
export function extractAcpSystemNotice(event: unknown): AcpSystemNotice | null {
  const common = extractCommonAcpSystemNotice(event);
  if (common) return common;
  const outer = record(event);
  const inner = record(outer?.update) ?? outer;
  if (inner?.sessionUpdate !== "agent_message_chunk") return null;
  const meta = record(inner._meta);
  const codex = record(meta?.codex);
  const text = record(inner.content)?.text;
  if (codex?.phase !== "final_answer" && typeof text === "string") {
    const split = splitAcpSystemNoticeText(text);
    if (split.notice) {
      return { message: split.notice, tone: "warning" };
    }
  }
  const notify = record(record(record(inner._meta)?.piAcp)?.notify);
  if (notify?.level !== "warning") return null;
  return typeof text === "string" && text.trim().length > 0
    ? { message: text.trim(), tone: "warning" }
    : null;
}
