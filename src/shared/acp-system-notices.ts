export type AcpSystemNotice = {
  message: string;
  tone: "warning";
};

const CODEX_SKILL_CONTEXT_WARNING =
  /^Warning:\s*Skill descriptions were shortened to fit the \d+% skills context budget\./;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function extractAcpSystemNotice(event: unknown): AcpSystemNotice | null {
  const outer = asRecord(event);
  const wrapped = asRecord(outer?.update);
  const inner = wrapped ?? outer;
  if (!inner || inner.sessionUpdate !== "agent_message_chunk") return null;

  const meta = asRecord(inner._meta);
  const codex = asRecord(meta?.codex);
  if (codex?.phase === "final_answer") return null;

  const content = asRecord(inner.content);
  const text = typeof content?.text === "string" ? content.text.trim() : "";
  if (!CODEX_SKILL_CONTEXT_WARNING.test(text)) return null;

  return { message: text, tone: "warning" };
}
