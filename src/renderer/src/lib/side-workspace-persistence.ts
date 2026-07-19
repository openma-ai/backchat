import type {
  PersistedSideWorkspaceInfo,
  SideWorkspaceSaveParams,
} from "@shared/api.js";
import type {
  SessionStore,
  TaskSideWorkspaceSnapshot,
} from "./session-store";

type WorkspaceStore = Pick<
  SessionStore,
  "subscribe" | "sideWorkspaceSnapshots" | "hydrateSideWorkspaces"
>;

interface WorkspaceApi {
  sideWorkspaceSave(p: SideWorkspaceSaveParams): Promise<void>;
  sideWorkspaceDelete(p: { task_id: string }): Promise<void>;
}

export interface SideWorkspacePersistence {
  hydrate(rows: PersistedSideWorkspaceInfo[]): void;
  start(): void;
  flush(): Promise<void>;
  dispose(): void;
}

/** Keep renderer-owned task workspaces durable without making every store
 *  mutation await IPC. Writes are coalesced and content-addressed by their
 *  serialized JSON, so unrelated chat streaming does not rewrite unchanged
 *  sidebars. */
export function createSideWorkspacePersistence(
  store: WorkspaceStore,
  api: WorkspaceApi,
  debounceMs = 350,
): SideWorkspacePersistence {
  const persisted = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let disposed = false;

  const schedule = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush().catch((error) => {
        console.warn("Failed to persist task side workspace", error);
      });
    }, debounceMs);
  };

  const hydrate = (rows: PersistedSideWorkspaceInfo[]) => {
    const snapshots: TaskSideWorkspaceSnapshot[] = [];
    for (const row of rows) {
      if (!row.task_id || typeof row.state_json !== "string") continue;
      persisted.set(row.task_id, row.state_json);
      try {
        const state = JSON.parse(row.state_json) as TaskSideWorkspaceSnapshot["state"];
        if (state?.version === 1) snapshots.push({ taskId: row.task_id, state });
      } catch {
        // Keep the invalid row in `persisted`; the first flush sees that no
        // current snapshot owns it and deletes the corrupt entry.
      }
    }
    store.hydrateSideWorkspaces(snapshots);
  };

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const current = new Map(
      store.sideWorkspaceSnapshots().map((snapshot) => [
        snapshot.taskId,
        JSON.stringify(snapshot.state),
      ]),
    );

    const saves: Promise<void>[] = [];
    for (const [taskId, stateJson] of current) {
      if (persisted.get(taskId) === stateJson) continue;
      saves.push(
        api.sideWorkspaceSave({ task_id: taskId, state_json: stateJson }).then(() => {
          persisted.set(taskId, stateJson);
        }),
      );
    }
    for (const taskId of persisted.keys()) {
      if (current.has(taskId)) continue;
      saves.push(
        api.sideWorkspaceDelete({ task_id: taskId }).then(() => {
          persisted.delete(taskId);
        }),
      );
    }
    await Promise.all(saves);
  };

  return {
    hydrate,
    start() {
      if (unsubscribe || disposed) return;
      unsubscribe = store.subscribe(schedule);
    },
    flush,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
      void flush().catch(() => undefined);
    },
  };
}
