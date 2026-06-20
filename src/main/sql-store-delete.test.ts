import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rebuildSessionIndexFromTranscriptFiles } from "./file-first-rebuild";
import {
  appendEvent,
  deleteSession,
  openSessionDb,
  upsertSession,
} from "./sql-store";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("sql-store hard delete file-first semantics", () => {
  it("removes transcript source files so rebuild does not resurrect the session", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-sql-store-delete-"));
    tempRoots.push(root);
    const now = Date.UTC(2026, 5, 14, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    openSessionDb(join(root, "sessions.db"));
    upsertSession({
      id: "sess_delete_file_first",
      agent_id: "codex-acp",
      cwd: join(root, "sessions", "sess_delete_file_first"),
      title: "Delete file-first source",
    });
    appendEvent("sess_delete_file_first", "user_prompt", { text: "delete me" });

    const transcriptPath = join(
      root,
      "transcripts",
      "2026",
      "06",
      "14",
      "sess_delete_file_first.jsonl",
    );
    const metadataPath = join(
      root,
      "transcripts",
      "2026",
      "06",
      "14",
      "sess_delete_file_first.meta.toml",
    );
    expect(existsSync(transcriptPath)).toBe(true);
    expect(existsSync(metadataPath)).toBe(true);

    deleteSession("sess_delete_file_first");

    expect(existsSync(transcriptPath)).toBe(false);
    expect(existsSync(metadataPath)).toBe(false);

    const rebuilt = openEmptyIndex();
    try {
      expect(rebuildSessionIndexFromTranscriptFiles(rebuilt, root)).toMatchObject({
        sessionsImported: 0,
        eventsImported: 0,
      });
      expect(rebuilt.prepare(`SELECT COUNT(*) AS count FROM sessions`).get()).toEqual({
        count: 0,
      });
    } finally {
      rebuilt.close();
    }
  });
});

function openEmptyIndex(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
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
      pair_id TEXT
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
    CREATE TABLE events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
  `);
  return db;
}
