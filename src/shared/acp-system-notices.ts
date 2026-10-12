import {
  extractAcpSystemNotice as extractCommonAcpSystemNotice,
  type AcpSystemNotice,
} from "@openma/common/session-events/acp";

export type { AcpSystemNotice };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Codex harness warnings use a `Warning: ` prefix and paragraph separator,
 * or arrive as an unterminated out-of-turn event; no wording allowlist applies. */
export function splitAcpSystemNoticeText(
  text: string,
  options?: { outOfTurn?: boolean },
): {
  notice?: string;
  transcript: string;
} {
  const candidate = text.trimStart();
  if (!/^Warning:[\t ]+\S/.test(candidate)) {
    return { transcript: text };
  }
  const paragraphBreak = candidate.search(/\r?\n[\t ]*\r?\n/);
  if (paragraphBreak < 0) {
    return options?.outOfTurn
      ? { notice: candidate.trim(), transcript: "" }
      : { transcript: text };
  }
  const separator = candidate.slice(paragraphBreak).match(/^\r?\n[\t ]*\r?\n/)?.[0]
    ?? "";
  return {
    notice: candidate.slice(0, paragraphBreak).trim(),
    transcript: candidate.slice(paragraphBreak + separator.length).trimStart(),
  };
}

export function extractAcpSystemNotice(
  event: unknown,
  options?: { outOfTurn?: boolean },
): AcpSystemNotice | null {
  const outer = record(event);
  const inner = record(outer?.update) ?? outer;
  const meta = record(inner?._meta);
  const codex = record(meta?.codex);
  const phaseTagged = codex?.phase === "final_answer" || codex?.phase === "commentary";
  if (!phaseTagged) {
    const common = extractCommonAcpSystemNotice(event);
    if (common) return common;
  }
  if (inner?.sessionUpdate !== "agent_message_chunk") return null;
  const text = record(inner.content)?.text;
  if (!phaseTagged && typeof text === "string") {
    const split = splitAcpSystemNoticeText(text, options);
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
