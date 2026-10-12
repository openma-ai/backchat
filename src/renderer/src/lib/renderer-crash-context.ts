import { router } from "@/router";
import { sessionStore } from "@/lib/session-store";
import type { RendererCrashContext } from "./renderer-crash-report";

/**
 * Route + active session at crash time, stamped onto every crash report.
 * Reads are cheap and synchronous; a dying renderer may leave stores
 * partially initialized, so every access is guarded.
 */
export function rendererCrashContext(): RendererCrashContext {
  return {
    route: currentRoute(),
    session: currentSession(),
  };
}

function currentRoute(): string | undefined {
  try {
    const pathname = router.state?.location?.pathname;
    return typeof pathname === "string" && pathname ? pathname : undefined;
  } catch {
    return undefined;
  }
}

function currentSession(): RendererCrashContext["session"] {
  try {
    const active = sessionStore.active();
    if (!active) return undefined;
    return { id: active.id, agentId: active.agent_id || undefined };
  } catch {
    return undefined;
  }
}
