import type { PromptSessionReference } from "../shared/session-events.js";

export function composePromptContext(input: {
  text: string;
  sessionReferences?: readonly PromptSessionReference[];
}): string {
  const references = (input.sessionReferences ?? []).filter(
    (reference) =>
      typeof reference.session_id === "string" &&
      typeof reference.title === "string" &&
      reference.session_id.trim() &&
      reference.title.trim(),
  );
  if (references.length === 0) return input.text;

  const context = [
    "# Referenced sessions:",
    "The user mentioned the following other Backchat sessions. Use the `openma_sessions_read` tool for the session IDs below when you need their conversation content; do not guess or rely on the titles alone.",
    "<session-references>",
    JSON.stringify(references),
    "</session-references>",
  ].join("\n");
  return input.text.trim().length > 0
    ? `${context}\n\n${input.text}`
    : context;
}
