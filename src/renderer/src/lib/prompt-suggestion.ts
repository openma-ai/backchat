/** Claude Code's predicted follow-up prompt.
 *
 *  After a turn the agent may publish a guess at what the user would ask
 *  next. It rides on `session_info_update._meta.promptSuggestions` and is
 *  only sent to clients that declared the AIR gate, so only Claude sessions
 *  ever carry one. The composer shows it as ghost text while the composer
 *  is empty; it is never part of the transcript. */

export interface PromptSuggestionUpdate {
  /** The update carried a `promptSuggestions` key at all. An update without
   *  one says nothing about the suggestion, so the previous one stands. */
  present: boolean;
  /** The first usable suggestion, or null when the agent cleared the list. */
  text: string | null;
}

const NO_SUGGESTION: PromptSuggestionUpdate = { present: false, text: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Read the suggestion out of a `session_info_update` payload's `_meta`.
 *
 *  The wire shape is `{ promptSuggestions: { suggestions: [{ text }] } }`.
 *  An empty list clears the suggestion; a list of blank entries is the same
 *  thing as an empty one. */
export function readPromptSuggestion(meta: unknown): PromptSuggestionUpdate {
  if (!isRecord(meta)) return NO_SUGGESTION;
  const raw = meta.promptSuggestions;
  // A key with no value says nothing about the suggestion — the previous one
  // stands. Only a key that carries a payload speaks about it.
  if (raw === undefined) return NO_SUGGESTION;
  const entries = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.suggestions)
      ? raw.suggestions
      : [];
  for (const entry of entries) {
    const text = isRecord(entry) && typeof entry.text === "string"
      ? entry.text.trim()
      : "";
    if (text) return { present: true, text };
  }
  return { present: true, text: null };
}

/** The suggestion the composer shows as ghost text, or null when it must
 *  stay hidden.
 *
 *  The composer has to be strictly empty — a lone space is the user typing.
 *  `blocked` covers the surfaces that already own an empty composer: the
 *  slash picker, the skill chip, the auth prompt, the harness probe. */
export function resolvePromptSuggestionGhost({
  text,
  suggestion,
  dismissed = null,
  blocked = false,
}: {
  text: string;
  suggestion?: string | null;
  /** The suggestion the user dismissed with Escape. A new suggestion is a
   *  new string, so it shows again. */
  dismissed?: string | null;
  blocked?: boolean;
}): string | null {
  if (blocked) return null;
  if (text.length > 0) return null;
  const trimmed = suggestion?.trim();
  if (!trimmed) return null;
  if (dismissed?.trim() === trimmed) return null;
  return trimmed;
}
