/**
 * Renderer → main crash diagnostics. The same report shape is reused for
 * main-side webContents failure events (render-process-gone, did-fail-load,
 * unresponsive), where the fields the dead renderer could no longer supply
 * are filled from the last context it reported.
 */

export type RendererCrashSource =
  | "error-boundary"
  | "window.onerror"
  | "unhandledrejection"
  | "render-process-gone"
  | "unresponsive"
  | "did-fail-load";

export interface RendererCrashSessionContext {
  /** Session the user had open when the renderer failed. */
  id?: string;
  /** Agent backing that session (e.g. "codex-acp"). */
  agentId?: string;
}

export interface RendererCrashReport {
  source: RendererCrashSource;
  message: string;
  /** Short id echoed on the crash fallback; matches the log's `errorId`. */
  errorId?: string;
  stack?: string;
  componentStack?: string;
  /** Router path at crash time. Memory history keeps it out of the URL, so
   *  the renderer must send it explicitly. */
  route?: string;
  session?: RendererCrashSessionContext;
  /** Chromium render-process-gone reason, when applicable. */
  reason?: string;
  /** Process exit code or load error code, when applicable. */
  exitCode?: number;
  /** URL that failed to load (did-fail-load only). */
  url?: string;
}
