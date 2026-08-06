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

/** Preserve the common Codex warning classifier and add Pi's structured
 * `_meta.piAcp.notify.level=warning` signal. No warning is inferred from
 * natural-language wording. */
export function extractAcpSystemNotice(event: unknown): AcpSystemNotice | null {
  const common = extractCommonAcpSystemNotice(event);
  if (common) return common;
  const outer = record(event);
  const inner = record(outer?.update) ?? outer;
  if (inner?.sessionUpdate !== "agent_message_chunk") return null;
  const notify = record(record(record(inner._meta)?.piAcp)?.notify);
  if (notify?.level !== "warning") return null;
  const text = record(inner.content)?.text;
  return typeof text === "string" && text.trim().length > 0
    ? { message: text.trim(), tone: "warning" }
    : null;
}
