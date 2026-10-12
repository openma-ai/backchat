import { RendererCrashPage } from "@/components/RendererCrashPage";
import type { ErrorComponentProps } from "@tanstack/react-router";

/** TanStack Router in-route errors use the same surface as the root boundary. */
export function RouteErrorFallback({ error }: ErrorComponentProps) {
  const err = error instanceof Error ? error : new Error(String(error));
  return (
    <RendererCrashPage
      message={err.message || "Unknown error"}
      stack={err.stack}
    />
  );
}
