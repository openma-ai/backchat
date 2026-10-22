import { useSyncExternalStore } from "react";

/** One page the in-app browser actually visited. Kept renderer-local: the
 *  browser partition is in-memory, so this is the only memory of where the
 *  user has been, and it powers the new-tab page. */
export interface BrowserVisit {
  url: string;
  title?: string;
  faviconUrl?: string;
  visitedAt: number;
}

const STORAGE_KEY = "oma.browser.recentVisits.v1";
export const BROWSER_HISTORY_LIMIT = 12;

const listeners = new Set<() => void>();
let cache: BrowserVisit[] | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): BrowserVisit[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "[]") as unknown;
    cache = Array.isArray(parsed)
      ? parsed.filter((visit): visit is BrowserVisit =>
          !!visit && typeof visit === "object" && typeof (visit as BrowserVisit).url === "string")
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(next: BrowserVisit[]) {
  cache = next;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or privacy mode: the list still works for this window.
  }
  for (const listener of listeners) listener();
}

/** Only real web pages are remembered — not blank tabs, local files or
 *  internal schemes. */
export function isRememberableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Same page regardless of fragment or trailing slash. */
export function visitKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** Record a navigation, moving the page to the front. */
export function recordBrowserVisit(url: string, now = Date.now()): void {
  if (!isRememberableUrl(url)) return;
  const key = visitKey(url);
  const visits = load();
  const previous = visits.find((visit) => visitKey(visit.url) === key);
  const next = [
    { ...previous, url, visitedAt: now },
    ...visits.filter((visit) => visitKey(visit.url) !== key),
  ].slice(0, BROWSER_HISTORY_LIMIT);
  save(next);
}

/** Attach the title/favicon a page reported after it loaded. */
export function updateBrowserVisitMeta(
  url: string,
  meta: { title?: string; faviconUrl?: string },
): void {
  if (!isRememberableUrl(url)) return;
  const key = visitKey(url);
  const visits = load();
  const index = visits.findIndex((visit) => visitKey(visit.url) === key);
  if (index < 0) return;
  const current = visits[index]!;
  const title = meta.title?.trim() || current.title;
  // Some sites inline multi-resolution .ico data URLs (20KB+); keep the
  // persisted list small and fall back to the globe for those.
  const reported = meta.faviconUrl && meta.faviconUrl.length <= 8_192 ? meta.faviconUrl : undefined;
  const faviconUrl = reported || current.faviconUrl;
  if (title === current.title && faviconUrl === current.faviconUrl) return;
  const next = [...visits];
  next[index] = { ...current, title, faviconUrl };
  save(next);
}

export function removeBrowserVisit(url: string): void {
  const key = visitKey(url);
  save(load().filter((visit) => visitKey(visit.url) !== key));
}

export function clearBrowserHistory(): void {
  save([]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBrowserHistory(): BrowserVisit[] {
  return useSyncExternalStore(subscribe, load, load);
}

/** Test seam: forget the in-memory copy so storage is re-read. */
export function resetBrowserHistoryCacheForTests(): void {
  cache = null;
}
