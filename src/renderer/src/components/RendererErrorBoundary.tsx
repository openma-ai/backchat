import { Component, type ErrorInfo, type ReactNode } from "react";
import { RendererCrashPage } from "@/components/RendererCrashPage";
import { reportRendererCrash } from "@/lib/renderer-crash-report";

interface RendererErrorBoundaryProps {
  children: ReactNode;
}

interface RendererErrorBoundaryState {
  error: Error | null;
  errorId: string | undefined;
  componentStack: string | null;
}

/**
 * Root error boundary. A render-time crash anywhere in the app swaps in the
 * crash fallback and reports the error to backchat.log with an `errorId`
 * the fallback echoes — the id is the join between what the user sees and
 * the structured log entry.
 */
export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = {
    error: null,
    errorId: undefined,
    componentStack: null,
  };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<RendererErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack?.trim() || undefined;
    const errorId = reportRendererCrash(
      {
        source: "error-boundary",
        message: error.message || String(error),
        stack: error.stack,
        componentStack,
      },
      error,
    );
    this.setState({ componentStack: componentStack ?? null, errorId });
  }

  render(): ReactNode {
    const { error, errorId, componentStack } = this.state;
    if (error) {
      return (
        <RendererCrashPage
          errorId={errorId}
          message={error.message || "Unknown error"}
          stack={error.stack}
          componentStack={componentStack ?? undefined}
        />
      );
    }
    return this.props.children;
  }
}
