import {
  extractAcpSystemNotice as extractCommonAcpSystemNotice,
  type AcpSystemNotice,
} from "@openma/common/session-events/acp";

export type { AcpSystemNotice };

export type AcpSystemNoticeContext = {
  outOfTurn?: boolean;
  harness?: string;
  coalesced?: boolean;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** In-turn classification requires Codex provenance plus a chunk that is
 * exactly the warning envelope; out-of-turn needs only the prefix. Coalesced
 * splitting applies only to legacy rows. No wording allowlist is used. */
export function splitAcpSystemNoticeText(
  text: string,
  context?: AcpSystemNoticeContext,
): {
  notice?: string;
  transcript: string;
} {
  const candidate = text.trimStart();
  if (!/^Warning:[\t ]+\S/.test(candidate)) {
    return { transcript: text };
  }
  const paragraphBreak = candidate.search(/\r?\n[\t ]*\r?\n/);
  if (context?.outOfTurn) {
    if (paragraphBreak < 0) {
      return { notice: candidate.trim(), transcript: "" };
    }
  } else {
    if (!isCodexHarness(context?.harness) || paragraphBreak < 0) {
      return { transcript: text };
    }
  }

  const separator = candidate.slice(paragraphBreak).match(/^\r?\n[\t ]*\r?\n/)?.[0]
    ?? "";
  const transcript = candidate.slice(paragraphBreak + separator.length);
  const hasTranscript = transcript.trim().length > 0;
  if (!context?.outOfTurn && hasTranscript && !context?.coalesced) {
    return { transcript: text };
  }
  return {
    notice: candidate.slice(0, paragraphBreak).trim(),
    transcript: hasTranscript ? transcript.trimStart() : "",
  };
}

function isCodexHarness(harness?: string): boolean {
  return /codex/i.test(harness ?? "");
}

export function extractAcpSystemNotice(
  event: unknown,
  context?: AcpSystemNoticeContext,
): AcpSystemNotice | null {
  const outer = record(event);
  const inner = record(outer?.update) ?? outer;
  const meta = record(inner?._meta);
  const codex = record(meta?.codex);
  const phaseTagged = codex?.phase === "final_answer" || codex?.phase === "commentary";
  const piNotify = record(record(meta?.piAcp)?.notify);
  const piLevel = piNotify?.level;
  const common = phaseTagged ? null : extractCommonAcpSystemNotice(event);
  if (common && (piLevel === "warning" || piLevel === "error")) return common;
  if (inner?.sessionUpdate !== "agent_message_chunk") return null;
  const text = record(inner.content)?.text;
  if (!phaseTagged && typeof text === "string") {
    const split = splitAcpSystemNoticeText(text, context);
    if (split.notice) {
      return { message: split.notice, tone: "warning" };
    }
  }
  return null;
}
