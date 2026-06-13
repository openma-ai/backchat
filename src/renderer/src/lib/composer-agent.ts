export function resolveComposerAgentId({
  sessionAgentId,
  defaultAgentId,
}: {
  sessionAgentId?: string | null;
  defaultAgentId?: string | null;
}): string {
  const bound = sessionAgentId?.trim();
  if (bound) return bound;
  return defaultAgentId?.trim() ?? "";
}

export function isComposerAgentLocked(sessionAgentId?: string | null): boolean {
  return !!sessionAgentId?.trim();
}
