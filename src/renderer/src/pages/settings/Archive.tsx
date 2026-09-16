import { useCallback, useEffect, useRef, useState } from "react";
import { ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { useI18n } from "@/lib/i18n";
import { StatusNotice } from "@/components/ui/status-notice";
import { cn } from "@/lib/utils";
import { sessionStore } from "@/lib/session-store";
import type { PersistedSessionInfo } from "@shared/api.js";
import type { OpenmaTask } from "@shared/openma";
import { useOpenmaAccount } from "@/lib/openma-account";
type ArchiveEntry = PersistedSessionInfo & { openma?: OpenmaTask };

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
  const { t } = useI18n();
  const { data: account } = useOpenmaAccount();
  const scope = account?.user && account.status !== "signing_in" ? JSON.stringify(account.workspaces.filter((w) => !w.expired).map((w) => JSON.stringify([account.baseUrl, account.user!.id, w.id]))) : null;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const generation = useRef(0);
  const [rows, setRows] = useState<ArchiveEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [local, remote] = await Promise.all([sessionStore.listArchivedPersisted(), scope ? window.backchat.openmaTasksList() : Promise.resolve([])]);
      if (request !== generation.current || scope !== scopeRef.current) return;
      const tasks = remote.filter((task) => (JSON.parse(scope ?? "[]") as string[]).includes(JSON.stringify([task.baseUrl, task.userId, task.workspaceId])));
      sessionStore.seedOpenmaTasks(tasks);
      const remoteRows: ArchiveEntry[] = tasks.filter((task) => task.archivedAt != null).map((task) => ({
        id: task.id, agent_id: task.target.agentId, title: task.title, cwd: "", acp_session_id: "",
        title_manually_set: 1, last_used_at: task.updatedAt, created_at: task.createdAt,
        pinned_at: task.pinnedAt ?? null, archived_at: task.archivedAt!, project_id: null, additional_directories: [], openma: task,
      }));
      setRows([...local, ...remoteRows].sort((a, b) => (b.archived_at ?? 0) - (a.archived_at ?? 0)));
      setError(null);
    } catch (e) {
      if (request !== generation.current || scope !== scopeRef.current) return;
      // IPC handler missing (main process not restarted after a new
      // channel was added) or threw — show a real message instead of
      // a permanent Loading… spinner. The user can restart and reload.
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, [scope]);

  useEffect(() => {
    setRows(null);
    void refresh();
    const off = window.backchat.onOpenmaTaskUpdated(() => { void refresh(); });
    return () => { generation.current++; off(); };
  }, [refresh]);

  const onRestore = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        await sessionStore.unarchive(id);
        if (scope !== scopeRef.current) return;
        // Re-seed the in-memory store with the full active list so
        // the unarchived row appears in the Sidebar immediately
        // (otherwise it'd only show after a reload). sessionsList
        // already filters out archived rows.
        const fresh = await window.backchat.sessionsList(200);
        sessionStore.seedPersisted(fresh);
        await refresh();
      } catch (error) {
        if (scope === scopeRef.current) setError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    },
    [refresh, scope],
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
    <PageScaffold
      title={t("settings.archivedChats")}
      description="Restore returns a session to the sidebar. Delete permanently removes the chat history and any files under its session directory — this can't be undone."
    >
      {scope && <p className="text-xs text-fg-subtle">OpenMA archives are saved on this desktop. Remote tasks keep running and can be restored here.</p>}

      {rows === null && (
        <div className="text-xs text-fg-subtle">Loading…</div>
      )}

      {error && (
        <StatusNotice tone="danger">
          <div className="font-medium">Couldn't load archived chats</div>
          <div className="mt-0.5 opacity-80">
            {error}
          </div>
        </StatusNotice>
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
                    {r.openma ? `${r.openma.target.runtimeName} · ${r.openma.target.environmentName}` : r.agent_id || "—"}
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
                  {!r.openma && <button
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
                  </button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageScaffold>
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
