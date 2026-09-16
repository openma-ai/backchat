import { browserOpenTarget } from "@shared/browser-settings.js";
import { getSettings } from "@/lib/settings-store";
import { sessionStore } from "@/lib/session-store";
import { toast } from "sonner";

export function openInAppBrowserUrl(url: string, label?: string): void {
  sessionStore.openSideTab("browser", url, label);
}

export function openExternalBrowserUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function openBrowserAwareUrl(url: string, label?: string): void {
  if (sessionStore.active()?.openma) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    if (!["http:", "https:"].includes(parsed.protocol)) return;
    if (parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost") || parsed.hostname === "[::1]" || parsed.hostname === "0.0.0.0" || parsed.hostname.startsWith("127.")) {
      toast.error("This address belongs to the remote environment. Open its preview through OpenMA.");
      return;
    }
    openExternalBrowserUrl(url);
    return;
  }
  const target = browserOpenTarget(url, getSettings()?.browser);
  if (target === "in_app") {
    openInAppBrowserUrl(url, label);
    return;
  }
  openExternalBrowserUrl(url);
}
