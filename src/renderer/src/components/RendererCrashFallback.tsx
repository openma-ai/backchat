import { createRoot, type Root } from "react-dom/client";
import { RendererCrashPage } from "@/components/RendererCrashPage";
import type { RendererCrashView } from "@/lib/renderer-crash-report";

let fallbackRoot: Root | null = null;

/**
 * Show the crash page over whatever remains of the app after a fatal
 * uncaught (non-React) error. A dedicated React root keeps working even
 * when the main tree is the thing that broke — and mounting into a fresh
 * host element avoids re-rendering into a half-broken tree.
 */
export function showRendererCrashFallback(view: RendererCrashView): void {
  if (fallbackRoot) return;
  const host = document.createElement("div");
  host.dataset.rendererCrashFallback = "true";
  document.body.appendChild(host);
  fallbackRoot = createRoot(host);
  fallbackRoot.render(<RendererCrashPage {...view} />);
}
