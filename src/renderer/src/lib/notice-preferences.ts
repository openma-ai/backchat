import { useSyncExternalStore } from "react";

const storageKey = "backchat:hidden-notices:v1";
const listeners = new Set<() => void>();
function read(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(stored) ? stored.filter((v): v is string => typeof v === "string") : [];
  } catch { return []; }
}
let hidden = read();

export function noticePreferenceKey(message: string): string {
  const normalized = message.trim().replace(/\s+/g, " ");
  if (/^(?:Warning:\s*)?Skill descriptions were shortened(?:\.| to fit the skills context budget\.)/i.test(normalized)) {
    return "skills-description-context-budget";
  }
  return normalized;
}
export function hideNoticePermanently(message: string) {
  hidden = [...new Set([...hidden, noticePreferenceKey(message)])];
  try { localStorage.setItem(storageKey, JSON.stringify(hidden)); } catch { /* Keep the choice for this app session. */ }
  for (const listener of listeners) listener();
}
export function useNoticeHidden(message: string): boolean {
  const key = noticePreferenceKey(message);
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => hidden.includes(key), () => hidden.includes(key));
}
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key !== storageKey) return;
  hidden = read();
  for (const listener of listeners) listener();
});
