import { useCallback, useEffect, useState } from "react";
import { ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { sessionStore } from "@/lib/session-store";
import type { PersistedSessionInfo } from "@shared/api.js";

/**
 * Archive — Settings sub-page that lists archived sessions and lets
 * the user either restore them (back into the sidebar) or hard-delete
 * (drop SQL row + on-disk session dir).
 *
 * The list is fetched on mount and re-fetched after every mutation so
 * the page always reflects the latest SQL state. Not wired into
 * useSyncExternalStore because archived rows aren't tracked in the
 * in-memory session store — they only exist in SQLite and on disk.
 *
 * Delete shows an inline two-step confirm (click once = "are you
 * sure?", click again = commits). Restore is one click and surfaces
 * the row by re-seeding sessionStore with the full sidebar list so
 * the unarchived row appears in the Sidebar right away.
 */
export function Archive() {
  const [rows, setRows] = useState<PersistedSessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await sessionStore.listArchivedPersisted();
      setRows(next);
      setError(null);
    } catch (e) {
      // IPC handler missing (main process not restarted after a new
      // channel was added) or threw — show a real message instead of
      // a permanent Loading… spinner. The user can restart and reload.
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onRestore = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        sessionStore.unarchive(id);
        // Re-seed the in-memory store with the full active list so
        // the unarchived row appears in the Sidebar immediately
        // (otherwise it'd only show after a reload). sessionsList
        // already filters out archived rows.
        const fresh = await window.backchat.sessionsList(200);
        sessionStore.seedPersisted(fresh);
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const onDelete = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        await sessionStore.deletePermanently(id);
        setConfirmingDelete(null);
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  return (
    <div className="space-y-5 text-xs">
      <header>
        <h1 className="text-sm font-medium text-fg">Archived sessions</h1>
        <p className="mt-1 max-w-2xl text-[11px] leading-5 text-fg-muted">
        Restore returns a session to the sidebar. Delete permanently
        removes the chat history and any files under its session
        directory — this can&apos;t be undone.
        </p>
      </header>

      {rows === null && (
        <div className="text-xs text-fg-subtle">Loading…</div>
      )}

      {error && (
        <div className="rounded-xl border border-danger/35 bg-danger-subtle/30 px-3 py-2 text-[11px] text-danger shadow-card-soft">
          <div className="font-medium">无法加载归档列表</div>
          <div className="mt-0.5 opacity-80">
            {error}
            <br />
            <span className="text-[11px]">
              新加的 IPC 通道需要重启 Electron 主进程才能生效。请退出 app 重启。
            </span>
          </div>
        </div>
      )}

      {rows !== null && !error && rows.length === 0 && (
        <div className="rounded-xl border border-border/45 bg-bg/70 px-3 py-8 text-center text-xs text-fg-subtle shadow-card-soft">
          No archived sessions.
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-border/45 bg-bg/70 shadow-card-soft">
          {rows.map((r) => {
            const label = r.title || r.id;
            const isConfirming = confirmingDelete === r.id;
            const isBusy = busy === r.id;
            return (
              <li
                key={r.id}
                className={cn(
                  "flex min-h-10 items-center gap-3 px-3 py-2",
                  "border-b border-border/35 last:border-b-0",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-fg" title={label}>
                    {label}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-fg-subtle" title={r.cwd ?? ""}>
                    {r.agent_id || "—"}
                    {r.cwd ? ` · ${shortPath(r.cwd)}` : ""}
                    {r.archived_at ? ` · 归档于 ${formatDate(r.archived_at)}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void onRestore(r.id)}
                    disabled={isBusy}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                      "text-fg-muted hover:bg-bg-surface hover:text-fg",
                      "disabled:opacity-40 disabled:cursor-not-allowed",
                      "transition-colors",
                    )}
                  >
                    <ArchiveRestoreIcon className="size-3.5" />
                    <span>恢复</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isConfirming) void onDelete(r.id);
                      else setConfirmingDelete(r.id);
                    }}
                    onBlur={() => {
                      if (isConfirming) setConfirmingDelete(null);
                    }}
                    disabled={isBusy}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                      "transition-colors",
                      isConfirming
                        ? "bg-danger text-bg hover:bg-danger/90"
                        : "text-danger hover:bg-danger-subtle/40",
                      "disabled:opacity-40 disabled:cursor-not-allowed",
                    )}
                  >
                    <Trash2Icon className="size-3.5" />
                    <span>{isConfirming ? "确认删除" : "彻底删除"}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Compress an absolute path to the last two segments so a long
 *  `/Users/.../sessions/<sid>` reads cleanly in a 320px column. */
function shortPath(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return ".../" + parts.slice(-2).join("/");
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
