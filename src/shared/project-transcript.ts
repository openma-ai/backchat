/** Canonical full messages supersede streamed chunks with the same message ID. */
export function projectResponseText(
  events: readonly { type: string; data: unknown }[],
): string {
  const messages = new Map<string, { chunks: string; final?: string }>();
  let anonymous = 0;
  for (const event of events) {
    if (event.type !== "agent.message" && event.type !== "agent.message_chunk")
      continue;
    const data = event.data as { message_id?: string; text?: string };
    const key = data.message_id ?? `anonymous:${anonymous}`;
    const message = messages.get(key) ?? { chunks: "" };
    if (event.type === "agent.message") {
      message.final = data.text ?? "";
      if (!data.message_id) anonymous++;
    } else message.chunks += data.text ?? "";
    messages.set(key, message);
  }
  return [...messages.values()]
    .map((m) => m.final ?? m.chunks)
    .filter(Boolean)
    .join("\n\n");
}
