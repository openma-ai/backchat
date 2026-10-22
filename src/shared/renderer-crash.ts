/** Renderer → main crash diagnostics (also used for main-process webContents events). */

export type RendererCrashSource =
  | "error-boundary"
  | "window.onerror"
  | "unhandledrejection"
  | "render-process-gone"
  | "unresponsive";

export interface RendererCrashReport {
  source: RendererCrashSource;
  message: string;
  stack?: string;
  componentStack?: string;
  /** Chromium render-process-gone reason, when applicable. */
  reason?: string;
  exitCode?: number;
}
