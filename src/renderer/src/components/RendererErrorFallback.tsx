import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatRendererCrashDetails } from "@/lib/renderer-crash-report";

export interface RendererErrorFallbackProps {
  message: string;
  stack?: string;
  componentStack?: string;
}

/** Full-window fallback when the React tree crashes. Clears the macOS titlebar band first. */
export function RendererErrorFallback({
  message,
  stack,
  componentStack,
}: RendererErrorFallbackProps) {
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");

  const copyDetails = useCallback(async () => {
    const text = formatRendererCrashDetails({ message, stack, componentStack });
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("done");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 2500);
    }
  }, [message, stack, componentStack]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col app-canvas-surface text-fg"
      data-renderer-error-fallback="true"
    >
      <div className="app-drag-region h-9 shrink-0" aria-hidden="true" />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-16">
        <div className="app-panel-surface w-full max-w-md rounded-xl px-6 py-8 text-center shadow-sm">
          <h1 className="text-base font-medium text-fg">Something went wrong</h1>
          <p className="mt-2 text-sm text-fg-subtle">
            The interface hit an unexpected error. You can reload the window or copy
            details for support.
          </p>
          <p className="mt-4 break-words text-left font-mono text-xs text-fg-muted">
            {message}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button type="button" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <Button type="button" variant="outline" onClick={() => void copyDetails()}>
              {copyState === "done"
                ? "Copied"
                : copyState === "failed"
                  ? "Copy failed"
                  : "Copy details"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
