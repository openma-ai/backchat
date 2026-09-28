import { useSyncExternalStore } from "react";

const key = "backchat:removed-projects:v1";
const listeners = new Set<() => void>();
let paths: readonly string[] = read();
function read(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === "string") : [];
  } catch { return []; }
}
export function rememberRemovedProject(roots: readonly string[]) {
  const next = [...new Set([...paths, ...roots])];
  localStorage.setItem(key, JSON.stringify(next));
  paths = next;
  for (const listener of listeners) listener();
}
export function useRemovedProjectPaths(): readonly string[] {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => paths, () => paths);
}

if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key !== key) return;
  paths = read();
  for (const listener of listeners) listener();
});
