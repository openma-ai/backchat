import {
  extractAcpSystemNotice as extractCommonAcpSystemNotice,
  type AcpSystemNotice,
} from "@openma/common/session-events/acp";
import { getAgentInteractionProfile } from "./agent-interaction.js";

export type { AcpSystemNotice };

export type AcpSystemNoticeContext = {
  outOfTurn?: boolean;
  harness?: string;
  coalesced?: boolean;
  phase?: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** In-turn classification requires Codex provenance plus a chunk that is
 * exactly the warning envelope; out-of-turn needs Codex provenance and only
 * the prefix. Coalesced splitting applies only to legacy rows. No wording
 * allowlist is used. */
export function splitAcpSystemNoticeText(
  text: string,
  context?: AcpSystemNoticeContext,
): {
  notice?: string;
  transcript: string;
} {
  if (isModelOutputPhase(context?.phase)) {
    return { transcript: text };
  }
  const candidate = text.trimStart();
  if (!/^Warning:[\t ]+\S/.test(candidate)) {
    return { transcript: text };
  }
  if (
    getAgentInteractionProfile(context?.harness).source !== "codex_product"
  ) {
    return { transcript: text };
  }
  const paragraphBreak = candidate.search(/\r?\n[\t ]*\r?\n/);
  if (paragraphBreak < 0) {
    return context?.outOfTurn
      ? { notice: candidate.trim(), transcript: "" }
      : { transcript: text };
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

function isModelOutputPhase(phase?: string): boolean {
  return phase === "final_answer" || phase === "commentary";
}

export function extractAcpSystemNotice(
  event: unknown,
  context?: AcpSystemNoticeContext,
): AcpSystemNotice | null {
  const outer = record(event);
  const inner = record(outer?.update) ?? outer;
  const meta = record(inner?._meta);
  const codex = record(meta?.codex);
  const codexPhase = typeof codex?.phase === "string"
    ? codex.phase
    : undefined;
  const noticeContext = {
    ...context,
    phase: context?.phase ?? codexPhase,
  };
  const phaseTagged = isModelOutputPhase(noticeContext.phase);
  const piNotify = record(record(meta?.piAcp)?.notify);
  const piLevel = piNotify?.level;
  const piNotice = piLevel === "warning" || piLevel === "error";
  const isMessageChunk = inner?.sessionUpdate === "agent_message_chunk";
  const common = isMessageChunk && !phaseTagged && piNotice
    ? extractCommonAcpSystemNotice(event)
    : null;
  if (common) return common;
  if (!isMessageChunk) return null;
  const text = record(inner.content)?.text;
  if (typeof text === "string") {
    const split = splitAcpSystemNoticeText(text, noticeContext);
    if (split.notice) {
      return { message: split.notice, tone: "warning" };
    }
  }
  return null;
}
