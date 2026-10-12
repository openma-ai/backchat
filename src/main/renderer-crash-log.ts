import type { RendererCrashReport } from "../shared/renderer-crash.js";
import { logAppEvent } from "./app-log.js";

export function logRendererCrash(report: RendererCrashReport): void {
  logAppEvent("app.renderer_crash", {
    source: report.source,
    message: report.message,
    ...(report.stack ? { stack: report.stack } : {}),
    ...(report.componentStack ? { component_stack: report.componentStack } : {}),
    ...(report.reason ? { reason: report.reason } : {}),
    ...(report.exitCode !== undefined ? { exit_code: report.exitCode } : {}),
  });
}
