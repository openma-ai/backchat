import { browserOpenTarget } from "@shared/browser-settings.js";
import { getSettings } from "@/lib/settings-store";
import { sessionStore } from "@/lib/session-store";

export function openInAppBrowserUrl(url: string, label?: string): void {
  sessionStore.openSideTab("browser", url, label);
}

export function openExternalBrowserUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function openBrowserAwareUrl(url: string, label?: string): void {
  const target = browserOpenTarget(url, getSettings()?.browser);
  if (target === "in_app") {
    openInAppBrowserUrl(url, label);
    return;
  }
  openExternalBrowserUrl(url);
}
