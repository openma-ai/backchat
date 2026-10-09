import { Component, type ErrorInfo, type ReactNode } from "react";
import { RendererErrorFallback } from "@/components/RendererErrorFallback";
import { reportRendererCrash } from "@/lib/renderer-crash-report";

interface RendererErrorBoundaryProps {
  children: ReactNode;
}

interface RendererErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<RendererErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack?.trim() || undefined;
    this.setState({ componentStack: componentStack ?? null });
    reportRendererCrash({
      source: "error-boundary",
      message: error.message || String(error),
      stack: error.stack,
      componentStack,
    });
  }

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (error) {
      return (
        <RendererErrorFallback
          message={error.message || "Unknown error"}
          stack={error.stack}
          componentStack={componentStack ?? undefined}
        />
      );
    }
    return this.props.children;
  }
}
