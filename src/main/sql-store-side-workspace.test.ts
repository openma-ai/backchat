import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteSideWorkspace,
  listSideWorkspaces,
  openSessionDb,
  saveSideWorkspace,
} from "./sql-store";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("task side workspace persistence", () => {
  it("upserts, lists, and deletes versioned task workspace JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-side-workspace-"));
    tempRoots.push(root);
    openSessionDb(join(root, "sessions.db"));

    saveSideWorkspace({
      task_id: "task-a",
      state_json: JSON.stringify({ version: 1, tabs: [{ id: "browser-a" }] }),
    });
    saveSideWorkspace({
      task_id: "task-a",
      state_json: JSON.stringify({ version: 1, tabs: [{ id: "browser-b" }] }),
    });

    expect(listSideWorkspaces()).toEqual([
      expect.objectContaining({
        task_id: "task-a",
        state_json: JSON.stringify({ version: 1, tabs: [{ id: "browser-b" }] }),
        updated_at: expect.any(Number),
      }),
    ]);

    deleteSideWorkspace("task-a");
    expect(listSideWorkspaces()).toEqual([]);
  });
});
