/** Puts unsent text back into a session's composer (e.g. CMA settle-only 400). */
type Listener = (text: string) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribeComposerRestore(sessionId: string, listener: Listener): () => void {
  let set = listeners.get(sessionId);
  if (!set) listeners.set(sessionId, (set = new Set()));
  set.add(listener);
  return () => { set!.delete(listener); if (!set!.size) listeners.delete(sessionId); };
}

export function restoreComposerText(sessionId: string, text: string): boolean {
  const set = listeners.get(sessionId);
  if (!set?.size || !text.trim()) return false;
  for (const listener of set) listener(text);
  return true;
}
