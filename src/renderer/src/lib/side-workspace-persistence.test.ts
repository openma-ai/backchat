import { describe, expect, test, vi } from "vitest";
import type { PersistedSideWorkspaceInfo } from "@shared/api.js";
import type { TaskSideWorkspaceSnapshot } from "./session-store";
import { createSideWorkspacePersistence } from "./side-workspace-persistence";

function snapshot(taskId: string, label: string): TaskSideWorkspaceSnapshot {
  return {
    taskId,
    state: {
      version: 1,
      tabs: [{
        id: `${taskId}-browser`,
        type: "browser",
        label,
        payload: "https://example.test",
        createdAt: 1,
      }],
      activeTabId: `${taskId}-browser`,
      activeBrowserTabId: `${taskId}-browser`,
      artifacts: { files: [], services: [] },
      sideSessions: [],
      subagents: [],
    },
  };
}

describe("side workspace persistence coordinator", () => {
  test("hydrates valid rows, saves only changed tasks, and deletes removed tasks", async () => {
    let current = [snapshot("task-a", "Before")];
    const listeners = new Set<() => void>();
    const hydrateSideWorkspaces = vi.fn();
    const store = {
      subscribe: vi.fn((next: () => void) => {
        listeners.add(next);
        return () => {
          listeners.delete(next);
        };
      }),
      sideWorkspaceSnapshots: () => current,
      hydrateSideWorkspaces,
    };
    const api = {
      sideWorkspaceSave: vi.fn(async () => undefined),
      sideWorkspaceDelete: vi.fn(async () => undefined),
    };
    const persisted: PersistedSideWorkspaceInfo[] = [
      {
        task_id: "task-a",
        state_json: JSON.stringify(snapshot("task-a", "Before").state),
        updated_at: 1,
      },
      { task_id: "broken", state_json: "{", updated_at: 2 },
    ];

    const persistence = createSideWorkspacePersistence(store, api, 1);
    persistence.hydrate(persisted);
    expect(hydrateSideWorkspaces).toHaveBeenCalledWith([snapshot("task-a", "Before")]);

    persistence.start();
    await persistence.flush();
    expect(api.sideWorkspaceSave).not.toHaveBeenCalled();
    expect(api.sideWorkspaceDelete).toHaveBeenCalledWith({ task_id: "broken" });

    api.sideWorkspaceDelete.mockClear();
    current = [snapshot("task-a", "After"), snapshot("task-b", "New")];
    for (const next of listeners) next();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(api.sideWorkspaceSave).toHaveBeenCalledTimes(2);

    api.sideWorkspaceSave.mockClear();
    current = [snapshot("task-b", "New")];
    await persistence.flush();
    expect(api.sideWorkspaceDelete).toHaveBeenCalledWith({ task_id: "task-a" });
    persistence.dispose();
  });
});
