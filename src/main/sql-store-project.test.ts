import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  deleteProject,
  getProject,
  listProjects,
  openSessionDb,
  saveProject,
  upsertSession,
} from "./sql-store";

describe("sql-store projects", () => {
  let root = "";

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("persists a named project with an ordered primary folder and links sessions without owning them", async () => {
    root = await mkdtemp(join(tmpdir(), "openma-project-store-"));
    openSessionDb(join(root, "sessions.db"));

    saveProject({
      id: "proj-workspace",
      name: "Workspace",
      source_folders: ["/work/backend", "/work/frontend"],
      primary_folder: "/work/backend",
    });

    expect(getProject("proj-workspace")).toMatchObject({
      id: "proj-workspace",
      name: "Workspace",
      source_folders: ["/work/backend", "/work/frontend"],
      primary_folder: "/work/backend",
    });
    expect(listProjects()).toHaveLength(1);

    upsertSession({
      id: "sess-project",
      agent_id: "codex-acp",
      cwd: "/work/backend",
      project_id: "proj-workspace",
    });
    deleteProject("proj-workspace");

    expect(getProject("proj-workspace")).toBeNull();
    expect(listProjects()).toEqual([]);
  });
});
