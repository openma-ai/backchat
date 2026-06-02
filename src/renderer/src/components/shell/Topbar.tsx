import { CircleStopIcon, FolderIcon } from "lucide-react";
import { selectActive, useSessionStore } from "@/lib/session-store";

/**
 * Topbar — sits at the h-11 baseline. Shows the active session as a tiny
 * breadcrumb (workspace → session label) and any in-flight indicator.
 *
 * Phase 3 keeps this thin. Phase 4 adds breadcrumb segments per the
 * TanStack Router route metadata pattern.
 */
export function Topbar({ onCancel }: { onCancel: () => void }) {
  const active = useSessionStore(selectActive);
  if (!active) {
    return (
      <div className="flex w-full items-center text-sm text-fg-subtle">
        <span className="font-mono text-[11px] tracking-tight">openma desktop</span>
      </div>
    );
  }
  return (
    <div className="flex w-full items-center gap-3 text-sm">
      <div className="app-no-drag flex min-w-0 flex-1 items-center gap-2 text-fg-muted">
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="shrink-0 truncate text-fg">{active.label}</span>
        <StatusPill status={active.status} />
        <span className="ml-1 min-w-0 truncate font-mono text-[11px] text-fg-subtle">
          {shortenPath(active.cwd)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {active.status === "running" && (
          <button
            className="app-no-drag inline-flex items-center gap-1.5 rounded-md bg-bg-surface px-2 py-1 text-xs text-fg-muted hover:bg-bg-surface/80"
            onClick={onCancel}
          >
            <CircleStopIcon className="size-3.5" />
            Cancel turn
          </button>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "running"
      ? "bg-brand-subtle text-brand-fg"
      : status === "ready"
        ? "bg-success-subtle text-success"
        : status === "errored"
          ? "bg-danger-subtle text-danger"
          : status === "starting"
            ? "bg-warning-subtle text-warning"
            : "bg-bg-surface text-fg-subtle";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${cls}`}
    >
      {status}
    </span>
  );
}

/** Compact path for the breadcrumb. Strips the `/Users/<name>/` prefix
 *  AND collapses the openma-desktop sessions/ path noise — the user only
 *  cares about the session id portion. */
function shortenPath(p: string): string {
  if (!p) return "";
  // Strip home prefix.
  let s = p.replace(/^\/Users\/[^/]+/, "~");
  // The default per-session spawn cwd is
  // `~/Library/Application Support/openma-desktop/sessions/<id>` — collapse
  // it to just the trailing id so it doesn't dominate the topbar.
  const sessIdx = s.indexOf("/openma-desktop/sessions/");
  if (sessIdx >= 0) {
    const id = s.slice(sessIdx + "/openma-desktop/sessions/".length);
    return `(internal) ${id}`;
  }
  return s;
}
