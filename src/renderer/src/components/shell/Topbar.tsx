import { CircleStopIcon, FolderIcon } from "lucide-react";
import { selectActive, useSessionStore } from "@/lib/session-store";
import { cn } from "@/lib/utils";

/**
 * Topbar — sits at the h-11 baseline. Shows the active session as a tiny
 * breadcrumb (folder icon → session label → cwd hint → status) plus the
 * cancel-turn button while a turn is streaming.
 *
 * Empty state: nothing. The sidebar's `[openma]` brand is the global
 * identifier; a second "openma desktop" string here would be redundant
 * with it. We trade an empty topbar for cleaner real estate.
 */
export function Topbar({ onCancel }: { onCancel: () => void }) {
  const active = useSessionStore(selectActive);
  if (!active) return null;

  const cwdHint = displayCwd(active.cwd);
  return (
    <div className="flex w-full items-center gap-3 text-sm">
      <div className="app-no-drag flex min-w-0 flex-1 items-center gap-2 text-fg-muted">
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="shrink-0 truncate text-fg">{active.label}</span>
        <StatusLabel status={active.status} />
        {cwdHint && (
          <span className="ml-1 min-w-0 truncate font-mono text-[11px] text-fg-subtle">
            {cwdHint}
          </span>
        )}
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

/** Compact status label — text only, no colored pill. "ready" hides
 *  entirely (it's the boring default); only states the user might care
 *  about read. errored gets the one danger color we allow. */
function StatusLabel({ status }: { status: string }) {
  if (status === "ready") return null;
  return (
    <span
      className={cn(
        "shrink-0 text-[10px] font-medium uppercase tracking-wider",
        status === "errored" ? "text-danger" : "text-fg-subtle",
      )}
    >
      {status}
    </span>
  );
}

/** Path to show in the topbar. Returns null (not an "(internal)" string)
 *  when the cwd is one of openma-desktop's autocreated per-session dirs
 *  — those are bookkeeping the user didn't pick and shouldn't see. Only
 *  user-chosen workspace paths (Phase 4+) get displayed. */
function displayCwd(p: string): string | null {
  if (!p) return null;
  if (p.includes("/openma-desktop/sessions/")) return null;
  return p.replace(/^\/Users\/[^/]+/, "~");
}
