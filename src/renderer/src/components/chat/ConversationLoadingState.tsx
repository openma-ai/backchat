import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlertIcon, RotateCcwIcon } from "@/components/Icons";
import { OpenmaStartupLoader } from "@/components/OpenmaStartupLoader";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Full-surface or pane-scoped conversation loading state.
 * Shared across Main Chat, Side Chat, Pair Chat columns, and Project Coordinator
 * so every surface presents the same landing loader and accessibility contract.
 */
export function ConversationSurfaceLoader({
  label,
  overlay = false,
  compact = false,
  className,
}: {
  label?: string;
  overlay?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      data-chat-history-loading="true"
      className={cn(
        "flex h-full min-h-0 items-center justify-center text-fg-muted",
        overlay && "absolute inset-0 z-10 app-canvas-surface",
        className,
      )}
    >
      <OpenmaStartupLoader
        label={label ?? t("chat.loadingHistory")}
        className={compact ? "h-[52px] w-[64px]" : undefined}
      />
    </div>
  );
}

/**
 * Top-of-transcript status pill when paging older turns outside the current
 * history window, with an interactive retry fallback when paging fails.
 */
export function ConversationHistoryWindowStatus({
  loading,
  settling,
  error,
  onRetry,
  className,
}: {
  loading: boolean;
  settling: boolean;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  if (error) {
    return (
      <div
        role="alert"
        data-history-window-status="error"
        className={cn(
          "absolute left-1/2 top-3 z-20 inline-flex h-8 max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-full border border-danger/35 bg-bg px-3 text-xs text-danger shadow-sm",
          className,
        )}
      >
        <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{error}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            data-history-window-retry="true"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-bg-surface px-2 py-0.5 text-[11px] font-medium text-fg transition-colors hover:bg-bg-bubble"
          >
            <RotateCcwIcon className="size-3" aria-hidden="true" />
            <span>{t("common.retry")}</span>
          </button>
        )}
      </div>
    );
  }
  if (!loading && !settling) return null;
  const label = t("chat.loadingEarlier");
  return (
    <div
      role="status"
      aria-label={label}
      data-history-window-status="loading"
      className={cn(
        "pointer-events-none absolute left-1/2 top-3 z-20 inline-flex h-8 -translate-x-1/2 items-center gap-2 rounded-full border border-border-strong bg-bg px-3 text-xs text-fg-muted shadow-sm",
        className,
      )}
    >
      <Spinner className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
}

/**
 * Fallback state shown when a conversation surface fails to load history or
 * encounters a rendering error, preventing a blank/black pane.
 */
export function ConversationErrorFallback({
  title,
  message,
  onRetry,
  overlay = false,
  compact = false,
  className,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  overlay?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      data-chat-error-fallback="true"
      className={cn(
        "flex h-full min-h-0 flex-col items-center justify-center px-6 text-center",
        overlay && "absolute inset-0 z-20 app-canvas-surface",
        className,
      )}
    >
      <div
        className={cn(
          "flex max-w-sm flex-col items-center rounded-xl border border-border-strong bg-bg-surface px-5 py-4 shadow-sm",
          compact && "px-4 py-3",
        )}
      >
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-danger/10 text-danger">
          <CircleAlertIcon className="size-4" aria-hidden="true" />
        </span>
        <p className="mt-2.5 text-sm font-medium text-fg">
          {title ?? t("crash.title")}
        </p>
        {message && (
          <p className="mt-1 line-clamp-3 break-words text-xs leading-5 text-fg-muted">
            {message}
          </p>
        )}
        {onRetry && (
          <button
            type="button"
            data-chat-error-retry="true"
            onClick={onRetry}
            className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong bg-bg px-2.5 text-xs font-medium text-fg shadow-2xs transition-colors hover:bg-bg-bubble focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcwIcon className="size-3.5" aria-hidden="true" />
            <span>{t("common.retry")}</span>
          </button>
        )}
      </div>
    </div>
  );
}

interface ConversationErrorBoundaryProps {
  resetKey?: string | null;
  compact?: boolean;
  onRetry?: () => void;
  children: ReactNode;
}

interface ConversationErrorBoundaryState {
  error: Error | null;
}

/**
 * Isolates rendering errors within a single conversation surface so a malformed
 * turn or payload renders a recoverable fallback card instead of crashing the window.
 */
export class ConversationErrorBoundary extends Component<
  ConversationErrorBoundaryProps,
  ConversationErrorBoundaryState
> {
  state: ConversationErrorBoundaryState = { error: null };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<ConversationErrorBoundaryState> {
    return { error };
  }

  componentDidUpdate(prevProps: ConversationErrorBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ConversationErrorBoundary]", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <ConversationErrorFallback
          compact={this.props.compact}
          message={this.state.error.message}
          onRetry={() => {
            this.setState({ error: null });
            this.props.onRetry?.();
          }}
        />
      );
    }
    return this.props.children;
  }
}
