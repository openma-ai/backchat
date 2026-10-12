import type { RendererCrashReport } from "@shared/renderer-crash.js";

/**
 * Renderer crash capture → main's backchat.log pipeline.
 *
 * `reportRendererCrash` forwards a structured report over IPC and returns
 * the `errorId` stamped into the log entry — the crash fallback shows that
 * id so a user report can be matched to the log line.
 *
 * `installRendererCrashHandlers` subscribes `window.onerror` and
 * `unhandledrejection`. Uncaught exceptions are additionally fatal: the app
 * tree may be half-rendered, so `onFatalCrash` swaps in the crash fallback.
 * Unhandled promise rejections are logged only — they rarely corrupt the UI.
 */

export interface RendererCrashView {
  errorId: string;
  message: string;
  stack?: string;
  componentStack?: string;
}

export interface RendererCrashContext {
  route?: string;
  session?: { id?: string; agentId?: string };
}

export interface RendererCrashHandlerOptions {
  /** Called after a fatal uncaught error is reported (show the fallback). */
  onFatalCrash?: (view: RendererCrashView) => void;
  /** Route/session context stamped onto every report. */
  context?: () => RendererCrashContext;
}

let installed = false;
let options: RendererCrashHandlerOptions = {};
/** error object → errorId, so a report forwarded by both the error boundary
 *  and window.onerror lands once (dev React replays boundary errors). */
let reportedErrors = new WeakMap<object, string>();

export function newCrashErrorId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

/** Send a report to backchat.log. Returns the stamped `errorId`, or
 *  undefined when this exact error was already reported. */
export function reportRendererCrash(
  report: RendererCrashReport,
  error?: unknown,
): string | undefined {
  if (typeof error === "object" && error !== null) {
    const known = reportedErrors.get(error);
    if (known) return undefined;
  }
  const errorId = report.errorId ?? newCrashErrorId();
  if (typeof error === "object" && error !== null) {
    reportedErrors.set(error, errorId);
  }
  const context = options.context?.();
  const payload: RendererCrashReport = {
    ...context,
    ...report,
    errorId,
  };
  const api = typeof window === "undefined" ? undefined : window.backchat;
  if (!api?.rendererCrashLog) {
    console.error("[renderer-crash]", payload);
    return errorId;
  }
  void api.rendererCrashLog(payload).catch((sendError: unknown) => {
    console.error("[renderer-crash] IPC failed", sendError);
  });
  return errorId;
}

export function installRendererCrashHandlers(
  opts: RendererCrashHandlerOptions = {},
): void {
  if (installed) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  installed = true;
  options = opts;

  window.addEventListener("error", (event) => {
    // Element resource failures arrive as plain Events without .error or
    // .message — they are not uncaught exceptions.
    if (event.error === undefined && !event.message) return;
    const message = event.message || String(event.error ?? "Unknown error");
    // Chromium's ResizeObserver loop noise is a layout warning, not a crash.
    if (/resizeobserver loop/i.test(message)) return;
    const stack = stackFromUnknown(event.error);
    const errorId = reportRendererCrash(
      { source: "window.onerror", message, stack },
      event.error,
    );
    if (errorId !== undefined) {
      options.onFatalCrash?.({ errorId, message, stack });
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    reportRendererCrash(
      {
        source: "unhandledrejection",
        message: reason instanceof Error ? reason.message : String(reason),
        stack: stackFromUnknown(reason),
      },
      reason,
    );
  });
}

export function formatRendererCrashDetails(report: {
  errorId?: string;
  message: string;
  stack?: string;
  componentStack?: string;
}): string {
  const parts = [
    report.errorId ? `Error ID: ${report.errorId}` : undefined,
    report.message,
  ].filter((part): part is string => Boolean(part));
  if (report.stack) parts.push("", report.stack);
  if (report.componentStack) {
    parts.push("", "Component stack:", report.componentStack);
  }
  return parts.join("\n");
}

/** Test-only: lets a fresh install register listeners again. */
export function resetRendererCrashHandlersForTest(): void {
  installed = false;
  options = {};
  reportedErrors = new WeakMap();
}

function stackFromUnknown(value: unknown): string | undefined {
  if (value instanceof Error && value.stack) return value.stack;
  return undefined;
}
