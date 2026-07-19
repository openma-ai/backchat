import { XIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatusNoticeTone = "info" | "success" | "warning" | "danger";
export type StatusNoticeAppearance = "quiet" | "surface";

const surfaceToneClasses: Record<StatusNoticeTone, string> = {
  info: "bg-info-subtle/45 text-info",
  success: "bg-success-subtle/45 text-success",
  warning: "bg-warning-subtle/45 text-warning",
  danger: "bg-danger-subtle/45 text-danger",
};

const dotToneClasses: Record<StatusNoticeTone, string> = {
  info: "bg-info/80",
  success: "bg-success/80",
  warning: "bg-warning/80",
  danger: "bg-danger/80",
};

/**
 * Shared contextual status surface.
 *
 * Use `quiet` for transient operational notices in a fixed status lane and
 * `surface` for persistent errors next to the content they affect. Global,
 * one-shot action feedback remains a toast; agent-authored content never
 * belongs here.
 */
export function StatusNotice({
  tone = "info",
  appearance = "surface",
  dismissLabel,
  onDismiss,
  className,
  children,
  role,
  ...props
}: Omit<ComponentProps<"div">, "role"> & {
  tone?: StatusNoticeTone;
  appearance?: StatusNoticeAppearance;
  dismissLabel?: string;
  onDismiss?: () => void;
  children: ReactNode;
  role?: "alert" | "status";
}) {
  const resolvedRole = role ?? (tone === "danger" ? "alert" : "status");

  return (
    <div
      role={resolvedRole}
      aria-live={resolvedRole === "alert" ? "assertive" : "polite"}
      data-slot="status-notice"
      data-tone={tone}
      data-appearance={appearance}
      className={cn(
        "group flex items-start gap-2",
        appearance === "quiet"
          ? "px-1 py-1 text-[11px] leading-4 text-fg-muted"
          : cn("rounded-lg px-3 py-2 text-xs leading-5", surfaceToneClasses[tone]),
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "shrink-0 rounded-full",
          appearance === "quiet" ? "mt-[5px] size-1.5" : "mt-1.5 size-1.5",
          dotToneClasses[tone],
        )}
        aria-hidden="true"
      />
      <div
        className={cn(
          "min-w-0 flex-1 text-pretty",
          appearance === "quiet" && "line-clamp-2",
        )}
      >
        {children}
      </div>
      {onDismiss && dismissLabel && (
        <button
          type="button"
          aria-label={dismissLabel}
          title={dismissLabel}
          onClick={onDismiss}
          className={cn(
            "-my-1 -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md",
            "text-current opacity-40 transition-colors",
            "hover:bg-bg-surface/60 hover:opacity-100",
            "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border",
          )}
        >
          <XIcon className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
