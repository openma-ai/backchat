export interface SessionMentionCandidate {
  id: string;
  label: string;
  agentId: string;
}

export interface FileMentionCandidate {
  kind: "file";
  id: string;
  label: string;
  path: string;
  attachment: import("@shared/session-events.js").PromptAttachment;
}

export interface BrowseFileMentionCandidate {
  kind: "browse";
  id: "browse-files";
  label: string;
}

/** One row in the composer @ picker. Session rows and file rows deliberately
 * share only the small surface the menu needs, while retaining their payload
 * for the selection handler. */
export type ComposerMentionCandidate =
  | (SessionMentionCandidate & { kind: "session" })
  | FileMentionCandidate
  | BrowseFileMentionCandidate;

export function createBrowseFileMentionCandidate(): BrowseFileMentionCandidate {
  return {
    kind: "browse",
    id: "browse-files",
    label: "Choose a file…",
  };
}

export function filterFileMentionCandidates(
  files: readonly FileMentionCandidate[],
  query: string,
): FileMentionCandidate[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...files];
  return files.filter((file) =>
    [file.label, file.path].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    ),
  );
}

export interface SessionMentionMatch {
  query: string;
  start: number;
  end: number;
}

/** Resolve the standalone @token immediately before the caret. */
export function resolveSessionMention(
  text: string,
  caret: number,
): SessionMentionMatch | null {
  if (caret < 0 || caret > text.length) return null;
  const next = text[caret];
  if (next && !/\s/.test(next)) return null;
  const beforeCaret = text.slice(0, caret);
  const match = /(?:^|\s)@([^\s]*)$/.exec(beforeCaret);
  if (!match) return null;
  const query = match[1] ?? "";
  return {
    query,
    start: caret - query.length - 1,
    end: caret,
  };
}

export function filterSessionMentionCandidates(
  sessions: readonly SessionMentionCandidate[],
  currentSessionId: string | undefined,
  query: string,
): SessionMentionCandidate[] {
  const normalized = query.trim().toLocaleLowerCase();
  return sessions.filter((session) => {
    if (session.id === currentSessionId) return false;
    if (!normalized) return true;
    return [session.label, session.id, session.agentId].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    );
  });
}

export function consumeSessionMention(
  text: string,
  caret: number,
): { text: string; caret: number } {
  const match = resolveSessionMention(text, caret);
  if (!match) return { text, caret };
  // The selected session is rendered as a removable inline block in the
  // composer. Consume the textual @token so the label is not shown twice.
  // Keep a single separator when there is text on both sides of the block.
  const hasFollowingWhitespace = /\s/.test(text[match.end] ?? "");
  const suffixStart = hasFollowingWhitespace
    ? match.end + 1
    : match.end;
  const nextText = `${text.slice(0, match.start)}${text.slice(suffixStart)}`;
  return {
    text: nextText,
    caret: match.start,
  };
}
