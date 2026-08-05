import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  getPairSession,
  getSession,
  listSideWorkspaces,
  openSessionDb,
} from "./sql-store";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
  tempRoots.length = 0;
});

describe("legacy managed session cwd migration", () => {
  it("rewrites legacy managed paths across persisted task workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-legacy-cwd-"));
    tempRoots.push(root);
    const storageRoot = join(root, ".oma");
    const dbPath = join(storageRoot, "sessions.db");
    const legacySessionCwd = join(
      root,
      ".openma",
      "sessions",
      "sess-legacy",
    );
    const currentSessionCwd = join(
      root,
      ".oma",
      "sessions",
      "sess-legacy",
    );
    const unrelatedProjectCwd = join(
      root,
      "projects",
      ".openma",
      "sessions",
      "project-a",
    );

    await mkdir(storageRoot, { recursive: true });
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        acp_session_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        last_used_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        archived_at INTEGER,
        pinned_at INTEGER,
        pair_id TEXT,
        project_id TEXT
      );
      CREATE TABLE pair_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        workspace_cwd TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        archived_at INTEGER,
        pinned_at INTEGER
      );
      CREATE TABLE side_workspaces (
        task_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    legacyDb.prepare(`
      INSERT INTO sessions (
        id, agent_id, cwd, title, last_used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run("sess-legacy", "codex-acp", legacySessionCwd, "Legacy", 2, 1);
    legacyDb.prepare(`
      INSERT INTO sessions (
        id, agent_id, cwd, title, last_used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run("sess-project", "codex-acp", unrelatedProjectCwd, "Project", 2, 1);
    legacyDb.prepare(`
      INSERT INTO pair_sessions (
        id, title, workspace_cwd, created_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run("pair-legacy", "Legacy pair", legacySessionCwd, 1, 2);
    legacyDb.prepare(`
      INSERT INTO side_workspaces (task_id, state_json, updated_at)
      VALUES (?, ?, ?)
    `).run(
      "sess-legacy",
      JSON.stringify({
        version: 1,
        tabs: [
          { id: "file-a", type: "file", payload: legacySessionCwd },
          {
            id: "terminal-a",
            type: "terminal",
            payload: "",
            terminalCwd: legacySessionCwd,
          },
        ],
      }),
      3,
    );
    legacyDb.close();

    openSessionDb(dbPath);

    expect(getSession("sess-legacy")?.cwd).toBe(currentSessionCwd);
    expect(getSession("sess-project")?.cwd).toBe(unrelatedProjectCwd);
    expect(getPairSession("pair-legacy")?.workspace_cwd).toBe(
      currentSessionCwd,
    );
    expect(JSON.parse(listSideWorkspaces()[0]!.state_json)).toEqual({
      version: 1,
      tabs: [
        { id: "file-a", type: "file", payload: currentSessionCwd },
        {
          id: "terminal-a",
          type: "terminal",
          payload: "",
          terminalCwd: currentSessionCwd,
        },
      ],
    });
  });
});
