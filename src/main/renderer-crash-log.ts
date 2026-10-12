import { randomUUID } from "node:crypto";
import type { RendererCrashReport } from "../shared/renderer-crash.js";
import { sanitizeAuthenticationMessage } from "../shared/auth-errors.js";
import { logAppEvent } from "./app-log.js";

/**
 * Renderer crash diagnostics → backchat.log.
 *
 * Every event lands as one JSON line with an `errorId` the crash fallback
 * echoes back to the user, so a report of "black screen" can be matched to
 * its log entry. Secrets are stripped via the shared sanitizer before any
 * field is written.
 *
 * The renderer reports its own uncaught errors over IPC carrying route +
 * session context. Main keeps the latest context per webContents so
 * process-level events the dead renderer can't report (render-process-gone,
 * did-fail-load, unresponsive) still get stamped with it.
 */
interface RendererCrashContext {
  route?: string;
  sessionId?: string;
  agentId?: string;
}

const contextByWebContents = new Map<number, RendererCrashContext>();

/** Short id shared between the crash fallback and the log entry. */
export function newCrashErrorId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 8);
}

export function noteRendererCrashContext(
  webContentsId: number,
  context: RendererCrashContext,
): void {
  contextByWebContents.set(webContentsId, context);
}

export function forgetRendererCrashContext(webContentsId: number): void {
  contextByWebContents.delete(webContentsId);
}

/** Sanitize an arbitrary string before it enters the log. */
function text(value: string | undefined): string {
  return sanitizeAuthenticationMessage(value ?? "");
}

function contextFields(
  report: Pick<RendererCrashReport, "route" | "session">,
  webContentsId: number | undefined,
): Record<string, unknown> {
  const context = webContentsId === undefined
    ? undefined
    : contextByWebContents.get(webContentsId);
  const route = report.route ?? context?.route;
  const sessionId = report.session?.id ?? context?.sessionId;
  const agentId = report.session?.agentId ?? context?.agentId;
  return {
    ...(route ? { route: text(route) } : {}),
    ...(sessionId ? { session_id: text(sessionId) } : {}),
    ...(agentId ? { agent_id: text(agentId) } : {}),
  };
}

export function logRendererCrash(
  report: RendererCrashReport,
  webContentsId?: number,
): void {
  // Anything can arrive over IPC — never throw from a logging path.
  const details = (report ?? {}) as RendererCrashReport;
  logAppEvent("app.renderer_crash", {
    errorId: details.errorId ?? newCrashErrorId(),
    source: text(details.source).slice(0, 64) || "unknown",
    message: text(details.message),
    ...(details.stack ? { stack: text(details.stack) } : {}),
    ...(details.componentStack
      ? { component_stack: text(details.componentStack) }
      : {}),
    ...contextFields(details, webContentsId),
    ...(details.reason ? { reason: text(details.reason).slice(0, 128) } : {}),
    ...(details.exitCode !== undefined ? { exit_code: details.exitCode } : {}),
    ...(details.url ? { url: text(details.url) } : {}),
  });
}

/** Error-level renderer console messages — not crashes, but they are the
 *  only signal some renderer failures leave behind. */
export function logRendererConsoleError(
  details: { message?: string; sourceId?: string; lineNumber?: number },
  webContentsId?: number,
): void {
  logAppEvent("app.renderer_console_error", {
    errorId: newCrashErrorId(),
    message: text(details.message),
    ...(details.sourceId ? { source_id: text(details.sourceId) } : {}),
    ...(details.lineNumber !== undefined ? { line: details.lineNumber } : {}),
    ...contextFields({}, webContentsId),
  });
}

/** Non-renderer process exits (GPU, utility, plugin) from `app`'s
 *  child-process-gone — these can also black out the window. */
export function logChildProcessGone(details: {
  type?: string;
  reason?: string;
  exitCode?: number;
  name?: string;
}): void {
  logAppEvent("app.child_process_gone", {
    errorId: newCrashErrorId(),
    process_type: text(details.type).slice(0, 64) || "unknown",
    ...(details.name ? { name: text(details.name) } : {}),
    ...(details.reason ? { reason: text(details.reason) } : {}),
    ...(details.exitCode !== undefined ? { exit_code: details.exitCode } : {}),
  });
}
