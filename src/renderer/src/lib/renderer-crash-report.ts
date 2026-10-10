import type { RendererCrashReport } from "@shared/renderer-crash.js";

let installed = false;

export function reportRendererCrash(report: RendererCrashReport): void {
  const api = window.backchat;
  if (!api?.rendererCrashLog) {
    console.error("[renderer-crash]", report);
    return;
  }
  void api.rendererCrashLog(report).catch((error: unknown) => {
    console.error("[renderer-crash] IPC failed", error, report);
  });
}

export function installRendererCrashHandlers(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    reportRendererCrash({
      source: "window.onerror",
      message: event.message || String(event.error ?? "Unknown error"),
      stack: stackFromUnknown(event.error),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportRendererCrash({
      source: "unhandledrejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: stackFromUnknown(reason),
    });
  });
}

export function formatRendererCrashDetails(report: {
  message: string;
  stack?: string;
  componentStack?: string;
}): string {
  const parts = [report.message];
  if (report.stack) parts.push("", report.stack);
  if (report.componentStack) {
    parts.push("", "Component stack:", report.componentStack);
  }
  return parts.join("\n");
}

function stackFromUnknown(value: unknown): string | undefined {
  if (value instanceof Error && value.stack) return value.stack;
  return undefined;
}
