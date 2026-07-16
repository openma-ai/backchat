import { browserOpenTarget } from "@shared/browser-settings.js";
import { getSettings } from "@/lib/settings-store";
import { sessionStore } from "@/lib/session-store";

export function openBrowserAwareUrl(url: string, label?: string): void {
  const target = browserOpenTarget(url, getSettings()?.browser);
  if (target === "in_app") {
    sessionStore.openSideTab("browser", url, label);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
