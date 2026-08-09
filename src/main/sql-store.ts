/**
 * SQLite-backed session + event store. Main-process only.
 *
 * Backed by Node's built-in `node:sqlite` (became stable in Node 22.5;
 * Electron 42 ships Node 24.15 / V8 14, so we get it for free with zero
 * native rebuild). We initially tried `better-sqlite3` but the bleeding
 * V8 14 API (Electron 42's) is ahead of what's released on npm — the
 * V8::External::New signature changed and ABI'd-against-N-API binaries
 * don't even compile. node:sqlite sidesteps all of this.
 *
 * Two tables in `~/.oma/sessions.db`:
 *
 *   sessions      one row per chat the user has opened
 *   events        append-only log of OpenMA canonical envelopes for replay;
 *                 legacy ACP rows remain readable during migration
 *
 * Why two tables, not one JSON blob: chat history grows unbounded and
 * single-row updates would force a full re-serialize on every chunk. The
 * events table lets us append-only and replay by session_id ORDER BY seq
 * — same shape openma uses for its main event log (see packages/event-log
 * in the OSS repo). Canonical rows use type `openma_event`; the envelope's
 * optional `raw` field retains ACP/adapter evidence for compatibility.
 *
 * Persistence model:
 *   - SQLite remains the hot UI index for sidebar, replay, and FTS.
 *   - appendEvent also writes a transcript JSONL line under transcripts/
 *     so live session events are inspectable as ordinary files.
 *   - appendEventsTx still exists for legacy/import test fixtures; the
 *     migration path is to phase bulk callers toward file-primary writes.
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { stringify as toToml } from "smol-toml";
import { rebuildSessionIndexFromTranscriptFiles } from "./file-first-rebuild.js";
import { queryActivityStats } from "./activity-stats.js";
import type { ActivityStatsInfo } from "../shared/api.js";
import {
  normalizeProjectFolders,
  type ProjectInfo,
} from "../shared/projects.js";

export interface PersistedSession {
  id: string;
  agent_id: string;
  cwd: string;
  acp_session_id: string;
  title: string;
  /** 1 when the user explicitly renamed the session; agent-provided title
   *  updates must not overwrite it. */
  title_manually_set: number;
  last_used_at: number;
  created_at: number;
  archived_at: number | null;
  pinned_at: number | null;
  /** Durable project container. Null for standalone and legacy cwd-only chats. */
  project_id: string | null;
  /** When this session is a sub-member of a pair-chat, the wrapper pair
   *  row's id. Sidebar lists hide rows with `pair_id != null` and shows
   *  the pair row instead. */
  pair_id: string | null;
}

export interface PersistedPairSession {
  id: string;
  title: string;
  /** When non-empty, every member of the pair spawns in this cwd. When
   *  empty, each member gets an isolated `~/.oma/sessions/<member>/`
   *  via session-cwd's auto-allocation. */
  workspace_cwd: string;
  created_at: number;
  last_used_at: number;
  archived_at: number | null;
  pinned_at: number | null;
}

export interface PersistedEvent {
  seq: number;
  session_id: string;
  type: string;
  /** JSON-serialized legacy payload or an OpenMA canonical envelope. */
  data: string;
  ts: number;
}

export interface PersistedSideWorkspace {
  task_id: string;
  state_json: string;
  updated_at: number;
}

let _db: DatabaseSync | null = null;
let _storageRoot: string | null = null;
// Prepared statement cache — node:sqlite recommends preparing once and
// reusing. The cache also keeps the underlying StatementSync handles
// alive for the process lifetime; we never need to finalize them.
let _stmts: {
  getSession: StatementSync;
  upsert: StatementSync;
  touch: StatementSync;
  setTitle: StatementSync;
  renameTitle: StatementSync;
  archive: StatementSync;
  unarchive: StatementSync;
  pin: StatementSync;
  unpin: StatementSync;
  list: StatementSync;
  listArchived: StatementSync;
  listForSidebar: StatementSync;
  deleteRow: StatementSync;
  appendEvent: StatementSync;
  canonicalEventExists: StatementSync;
  sessionEventCount: StatementSync;
  loadHistory: StatementSync;
  saveSideWorkspace: StatementSync;
  listSideWorkspaces: StatementSync;
  deleteSideWorkspace: StatementSync;
  saveProject: StatementSync;
  getProject: StatementSync;
  listProjects: StatementSync;
  unlinkProjectSessions: StatementSync;
  deleteProject: StatementSync;
  // Pair-chat helpers — see PersistedPairSession + pair_sessions schema.
  upsertPair: StatementSync;
  touchPair: StatementSync;
  setPairTitleIfEmpty: StatementSync;
  pinPair: StatementSync;
  unpinPair: StatementSync;
  archivePair: StatementSync;
  unarchivePair: StatementSync;
  getPair: StatementSync;
  listPairs: StatementSync;
  listPairMembers: StatementSync;
} | null = null;

export function openSessionDb(path: string): void {
  if (_db) return;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path);
  // node:sqlite ships pragma support via exec(). Match what we had with
  // better-sqlite3: WAL for write durability + read concurrency, NORMAL
  // sync for the speed/safety sweet spot on local files, foreign_keys for
  // the events→sessions ON DELETE CASCADE relationship.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Schema is idempotent — first launch creates tables, subsequent launches
  // no-op. When we add columns we'll bump via PRAGMA user_version + ALTER.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      agent_id      TEXT NOT NULL,
      cwd           TEXT NOT NULL,
      acp_session_id TEXT NOT NULL DEFAULT '',
      title         TEXT NOT NULL DEFAULT '',
      title_manually_set INTEGER NOT NULL DEFAULT 0,
      last_used_at  INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      archived_at   INTEGER,
      pinned_at     INTEGER,
      pair_id       TEXT,
      project_id    TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_last_used_idx
      ON sessions(archived_at, last_used_at DESC);
    -- Indexes on pinned_at / pair_id are created after the ALTER
    -- migrations below — on a pre-existing db those columns may not
    -- exist yet, and CREATE INDEX here would abort this whole exec.

    -- pair_sessions — the "wrapper" row for a multi-agent chat. Each
    -- pair fans out the user's prompt to N sub-sessions (one row in
    -- the sessions table per member, linked via sessions.pair_id). The
    -- pair itself owns the user-facing title and the cwd policy:
    --   - workspace_cwd != ''  -> shared cwd, every member spawns there
    --   - workspace_cwd == ''  -> per-member cwd auto-allocated under
    --                            ~/.oma/sessions/<sub_id>/
    -- The pair row also acts as the sidebar entry — sub-sessions are
    -- "hidden" rows that exist only to carry events for replay.
    -- "hidden" rows that exist only to carry events for replay.
    CREATE TABLE IF NOT EXISTS pair_sessions (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL DEFAULT '',
      workspace_cwd  TEXT NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL,
      last_used_at   INTEGER NOT NULL,
      archived_at    INTEGER,
      pinned_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS pair_sessions_last_used_idx
      ON pair_sessions(archived_at, last_used_at DESC);

    CREATE TABLE IF NOT EXISTS events (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL,
      type        TEXT NOT NULL,
      data        TEXT NOT NULL,
      ts          INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS events_session_seq_idx
      ON events(session_id, seq);

    -- Renderer-owned task workspace for the right sidebar. The JSON is
    -- versioned and validated in the renderer; main keeps it opaque so UI
    -- migrations do not require a SQL column migration for every tab field.
    CREATE TABLE IF NOT EXISTS side_workspaces (
      task_id      TEXT PRIMARY KEY,
      state_json   TEXT NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS side_workspaces_updated_idx
      ON side_workspaces(updated_at DESC);

    -- A project is a durable container independent of its chats. Roots are
    -- ordered so the first path remains the primary cwd while the remaining
    -- paths become ACP additionalDirectories.
    CREATE TABLE IF NOT EXISTS projects (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      source_folders_json  TEXT NOT NULL DEFAULT '[]',
      primary_folder       TEXT NOT NULL DEFAULT '',
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_updated_idx
      ON projects(updated_at DESC);

    -- FTS5 virtual table for Cmd+K message search. Indexes user prompts
    -- + final assistant messages (the only event types with prose worth
    -- searching). Triggers below keep it in sync on every event insert /
    -- session delete; on first launch we'll be empty but new events
    -- populate it from then on. For historical events the user can
    -- rebuild via PRAGMA-driven re-index (out of scope for v0.1; the
    -- FTS just covers forward-going chat).
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      session_id UNINDEXED,
      seq UNINDEXED,
      type UNINDEXED,
      ts UNINDEXED,
      text,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- Auto-populate FTS from new persisted events. We only index the
    -- prose types: user_prompt, agent_message, agent_thought. Tool
    -- calls + structural events stay out of search (their JSON is
    -- noise + not useful for "find that chat where I asked X").
    DROP TRIGGER IF EXISTS events_ai_fts;
    CREATE TRIGGER events_ai_fts AFTER INSERT ON events
    WHEN new.type IN ('user_prompt', 'agent_message', 'agent_thought')
      AND json_valid(new.data)
    BEGIN
      INSERT INTO messages_fts(session_id, seq, type, ts, text)
      VALUES (new.session_id, new.seq, new.type, new.ts, json_extract(new.data, '$.text'));
    END;

    -- Canonical rows keep the OpenMA envelope in the data column; index their
    -- provider-neutral text without making the renderer understand SQL.
    -- This separate trigger is additive so existing databases retain the
    -- legacy trigger above during the migration window.
    DROP TRIGGER IF EXISTS events_ai_fts_openma;
    CREATE TRIGGER events_ai_fts_openma AFTER INSERT ON events
    WHEN new.type = 'openma_event'
      AND json_valid(new.data)
      AND json_extract(new.data, '$.type') IN (
        'agent.message',
        'agent.message_chunk',
        'agent.thinking'
      )
      AND json_extract(new.data, '$.data.text') IS NOT NULL
    BEGIN
      INSERT INTO messages_fts(session_id, seq, type, ts, text)
      VALUES (new.session_id, new.seq, new.type, new.ts, json_extract(new.data, '$.data.text'));
    END;

    -- Drop FTS rows when a session is removed (events CASCADE-delete via
    -- the FK; this trigger keeps FTS aligned). messages_fts is a virtual
    -- table so no FK; manual cleanup.
    CREATE TRIGGER IF NOT EXISTS sessions_bd_fts BEFORE DELETE ON sessions
    BEGIN
      DELETE FROM messages_fts WHERE session_id = old.id;
    END;
  `);

  // Idempotent migrations for columns added after a user already has a
  // db file. SQLite has no `ADD COLUMN IF NOT EXISTS`; probe via
  // PRAGMA table_info and ALTER only when missing. Match the column
  // definition in the CREATE TABLE above.
  const sessionCols = new Set(
    (db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>)
      .map((r) => r.name),
  );
  if (!sessionCols.has("pinned_at")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN pinned_at INTEGER`);
  }
  if (!sessionCols.has("pair_id")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN pair_id TEXT`);
  }
  if (!sessionCols.has("project_id")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN project_id TEXT`);
  }
  if (!sessionCols.has("title_manually_set")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN title_manually_set INTEGER NOT NULL DEFAULT 0`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS sessions_pinned_idx
      ON sessions(archived_at, pinned_at DESC);
    CREATE INDEX IF NOT EXISTS sessions_pair_idx
      ON sessions(pair_id);
    CREATE INDEX IF NOT EXISTS sessions_project_idx
      ON sessions(project_id);
  `);

  _db = db;
  _storageRoot = deriveStorageRoot(path);
  _stmts = {
    getSession: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
    upsert: db.prepare(`
      INSERT INTO sessions (
        id, agent_id, cwd, acp_session_id, title, last_used_at, created_at,
        pair_id, project_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        agent_id       = excluded.agent_id,
        cwd            = excluded.cwd,
        acp_session_id = CASE WHEN excluded.acp_session_id != ''
                              THEN excluded.acp_session_id
                              ELSE sessions.acp_session_id END,
        title          = CASE WHEN excluded.title != ''
                              AND sessions.title_manually_set = 0
                              THEN excluded.title
                              ELSE sessions.title END,
        last_used_at   = excluded.last_used_at,
        pair_id        = COALESCE(excluded.pair_id, sessions.pair_id),
        project_id     = COALESCE(excluded.project_id, sessions.project_id)
    `),
    touch: db.prepare(`UPDATE sessions SET last_used_at = ? WHERE id = ?`),
    setTitle: db.prepare(
      `UPDATE sessions SET title = ? WHERE id = ? AND title_manually_set = 0`,
    ),
    renameTitle: db.prepare(
      `UPDATE sessions SET title = ?, title_manually_set = 1 WHERE id = ?`,
    ),
    archive: db.prepare(`UPDATE sessions SET archived_at = ? WHERE id = ?`),
    unarchive: db.prepare(`UPDATE sessions SET archived_at = NULL WHERE id = ?`),
    pin: db.prepare(`UPDATE sessions SET pinned_at = ? WHERE id = ?`),
    unpin: db.prepare(`UPDATE sessions SET pinned_at = NULL WHERE id = ?`),
    /** Full session list split for the Sidebar's Pinned + Chats sections.
     *  Pinned first ordered by pinned_at desc, then unpinned by
     *  last_used_at desc. Archived rows are excluded — they're reached
     *  via Search instead. Single round trip per render. */
    listForSidebar: db.prepare(`
      SELECT * FROM sessions
      WHERE archived_at IS NULL AND pair_id IS NULL
      ORDER BY
        CASE WHEN pinned_at IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN pinned_at IS NOT NULL THEN pinned_at END DESC,
        last_used_at DESC
    `),
    list: db.prepare(`
      SELECT * FROM sessions
      WHERE archived_at IS NULL AND pair_id IS NULL
      ORDER BY last_used_at DESC
      LIMIT ?
    `),
    listArchived: db.prepare(`
      SELECT * FROM sessions
      WHERE archived_at IS NOT NULL
      ORDER BY archived_at DESC
    `),
    /** Hard-delete a session row. Cascading FK on the events table
     *  (`ON DELETE CASCADE`) wipes the per-session events in the same
     *  transaction, so the caller only has to remove the on-disk
     *  session dir separately. */
    deleteRow: db.prepare(`DELETE FROM sessions WHERE id = ?`),
    appendEvent: db.prepare(
      `INSERT INTO events (session_id, type, data, ts)
       VALUES (?, ?, CAST(? AS TEXT), ?)`,
    ),
    canonicalEventExists: db.prepare(`
      SELECT 1 AS found
      FROM events
      WHERE session_id = ?
        AND type = 'openma_event'
        AND CASE
          WHEN json_valid(data) THEN json_extract(data, '$.event_id')
          ELSE NULL
        END = ?
      LIMIT 1
    `),
    sessionEventCount: db.prepare(
      `SELECT COUNT(*) AS count FROM events WHERE session_id = ?`,
    ),
    loadHistory: db.prepare(
      `SELECT * FROM events WHERE session_id = ? ORDER BY seq ASC`,
    ),
    saveSideWorkspace: db.prepare(`
      INSERT INTO side_workspaces (task_id, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `),
    listSideWorkspaces: db.prepare(
      `SELECT * FROM side_workspaces ORDER BY updated_at ASC`,
    ),
    deleteSideWorkspace: db.prepare(
      `DELETE FROM side_workspaces WHERE task_id = ?`,
    ),
    saveProject: db.prepare(`
      INSERT INTO projects (
        id, name, source_folders_json, primary_folder, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        source_folders_json = excluded.source_folders_json,
        primary_folder = excluded.primary_folder,
        updated_at = excluded.updated_at
    `),
    getProject: db.prepare(`SELECT * FROM projects WHERE id = ?`),
    listProjects: db.prepare(`SELECT * FROM projects ORDER BY updated_at DESC`),
    unlinkProjectSessions: db.prepare(
      `UPDATE sessions SET project_id = NULL WHERE project_id = ?`,
    ),
    deleteProject: db.prepare(`DELETE FROM projects WHERE id = ?`),
    upsertPair: db.prepare(`
      INSERT INTO pair_sessions (id, title, workspace_cwd, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title         = CASE WHEN excluded.title != ''
                             THEN excluded.title
                             ELSE pair_sessions.title END,
        workspace_cwd = excluded.workspace_cwd,
        last_used_at  = excluded.last_used_at
    `),
    touchPair: db.prepare(`UPDATE pair_sessions SET last_used_at = ? WHERE id = ?`),
    setPairTitleIfEmpty: db.prepare(
      `UPDATE pair_sessions SET title = ? WHERE id = ? AND (title IS NULL OR title = '')`,
    ),
    pinPair: db.prepare(`UPDATE pair_sessions SET pinned_at = ? WHERE id = ?`),
    unpinPair: db.prepare(`UPDATE pair_sessions SET pinned_at = NULL WHERE id = ?`),
    archivePair: db.prepare(`UPDATE pair_sessions SET archived_at = ? WHERE id = ?`),
    unarchivePair: db.prepare(`UPDATE pair_sessions SET archived_at = NULL WHERE id = ?`),
    getPair: db.prepare(`SELECT * FROM pair_sessions WHERE id = ?`),
    listPairs: db.prepare(`
      SELECT * FROM pair_sessions
      WHERE archived_at IS NULL
      ORDER BY last_used_at DESC
    `),
    listPairMembers: db.prepare(
      `SELECT * FROM sessions WHERE pair_id = ? ORDER BY created_at ASC`,
    ),
  };

  rebuildSessionIndexFromTranscriptFiles(db, _storageRoot);

  const migratedLegacyPaths = migrateLegacyManagedSessionPaths(
    db,
    _storageRoot,
  );
  for (const sessionId of migratedLegacyPaths.sessionIds) {
    writeSessionMetadata(sessionId);
  }
  for (const pairId of migratedLegacyPaths.pairIds) {
    writePairSessionMetadata(pairId);
  }

  // One-time backfill: any session row that ended up with an empty title
  // (sessions created before setSessionTitleIfEmpty shipped) gets seeded
  // from its first user_prompt event. Truncate to 40 chars to match
  // derivePromptLabel. Idempotent — only writes when title is empty.
  db.exec(`
    UPDATE sessions
       SET title = (
         SELECT CASE
                  WHEN length(json_extract(e.data, '$.text')) <= 40
                  THEN json_extract(e.data, '$.text')
                  ELSE substr(json_extract(e.data, '$.text'), 1, 39) || '…'
                END
           FROM events e
          WHERE e.session_id = sessions.id
            AND e.type = 'user_prompt'
            AND json_extract(e.data, '$.text') IS NOT NULL
            AND json_extract(e.data, '$.text') != ''
       ORDER BY e.seq ASC
          LIMIT 1
       )
     WHERE (title IS NULL OR title = '')
       AND EXISTS (
         SELECT 1 FROM events e
          WHERE e.session_id = sessions.id
            AND e.type = 'user_prompt'
       );
  `);
}

function migrateLegacyManagedSessionPaths(
  db: DatabaseSync,
  storageRoot: string,
): { sessionIds: string[]; pairIds: string[] } {
  if (basename(storageRoot) !== ".oma") {
    return { sessionIds: [], pairIds: [] };
  }

  const legacySessionRoot = join(dirname(storageRoot), ".openma", "sessions");
  const currentSessionRoot = join(storageRoot, "sessions");
  const replaceManagedPath = (value: string): string => {
    if (value === legacySessionRoot) return currentSessionRoot;
    const legacyPrefix = legacySessionRoot + sep;
    if (!value.startsWith(legacyPrefix)) return value;
    return join(currentSessionRoot, value.slice(legacyPrefix.length));
  };

  const migratedSessionIds: string[] = [];
  const migratedPairIds: string[] = [];
  const updateSession = db.prepare(`UPDATE sessions SET cwd = ? WHERE id = ?`);
  const updatePair = db.prepare(
    `UPDATE pair_sessions SET workspace_cwd = ? WHERE id = ?`,
  );
  const updateSideWorkspace = db.prepare(
    `UPDATE side_workspaces SET state_json = ? WHERE task_id = ?`,
  );

  db.exec("BEGIN");
  try {
    const sessions = db.prepare(`SELECT id, cwd FROM sessions`).all() as Array<{
      id: string;
      cwd: string;
    }>;
    for (const session of sessions) {
      const cwd = replaceManagedPath(session.cwd);
      if (cwd === session.cwd) continue;
      updateSession.run(cwd, session.id);
      migratedSessionIds.push(session.id);
    }

    const pairs = db.prepare(
      `SELECT id, workspace_cwd FROM pair_sessions`,
    ).all() as Array<{ id: string; workspace_cwd: string }>;
    for (const pair of pairs) {
      const cwd = replaceManagedPath(pair.workspace_cwd);
      if (cwd === pair.workspace_cwd) continue;
      updatePair.run(cwd, pair.id);
      migratedPairIds.push(pair.id);
    }

    const sideWorkspaces = db.prepare(
      `SELECT task_id, state_json FROM side_workspaces`,
    ).all() as Array<{ task_id: string; state_json: string }>;
    for (const workspace of sideWorkspaces) {
      try {
        const parsed = JSON.parse(workspace.state_json) as unknown;
        const migrated = JSON.stringify(parsed, (_key, value: unknown) =>
          typeof value === "string" ? replaceManagedPath(value) : value
        );
        if (migrated !== workspace.state_json) {
          updateSideWorkspace.run(migrated, workspace.task_id);
        }
      } catch {
        // The renderer validates this opaque JSON separately. A malformed
        // snapshot is left untouched so this path migration cannot erase it.
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    sessionIds: migratedSessionIds,
    pairIds: migratedPairIds,
  };
}

function stmts() {
  if (!_stmts) throw new Error("session-store: openSessionDb() not called");
  return _stmts;
}

// -------------------- sessions --------------------

export function upsertSession(row: {
  id: string;
  agent_id: string;
  cwd: string;
  acp_session_id?: string;
  title?: string;
  last_used_at?: number;
  /** Set when this session is a sub-member of a pair-chat. Hidden from
   *  sidebar; reached only via the parent pair's grid view. */
  pair_id?: string | null;
  project_id?: string | null;
}): void {
  const now = Date.now();
  stmts().upsert.run(
    row.id,
    row.agent_id,
    row.cwd,
    row.acp_session_id ?? "",
    row.title ?? "",
    row.last_used_at ?? now,
    now,
    row.pair_id ?? null,
    row.project_id ?? null,
  );
  writeSessionMetadata(row.id);
}

export function touchSession(id: string): void {
  stmts().touch.run(Date.now(), id);
  writeSessionMetadata(id);
}

export function getSession(id: string): PersistedSession | null {
  return (stmts().getSession.get(id) as unknown as PersistedSession | undefined) ?? null;
}

export function setSessionTitle(id: string, title: string): void {
  stmts().setTitle.run(title, id);
  writeSessionMetadata(id);
}

/** Persist a title explicitly chosen by the user. Future agent metadata
 *  updates are ignored for this row so a manual rename remains stable. */
export function renameSession(id: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Session title is required");
  stmts().renameTitle.run(trimmed.slice(0, 500), id);
  writeSessionMetadata(id);
}

/** Conditional version — only writes the title if the row's current
 *  title is empty. Lets the first user prompt seed a sensible label
 *  without overwriting whatever the user may have later renamed it to. */
export function setSessionTitleIfEmpty(id: string, title: string): void {
  const row = stmts().getSession.get(id) as PersistedSession | undefined;
  if (!row || row.title) return;
  stmts().setTitle.run(title, id);
  writeSessionMetadata(id);
}

export function archiveSession(id: string): void {
  stmts().archive.run(Date.now(), id);
  writeSessionMetadata(id);
}

export function unarchiveSession(id: string): void {
  stmts().unarchive.run(id);
  writeSessionMetadata(id);
}

/** List every archived session, newest archive first. Used by the
 *  Settings → Archive page so the user can browse and either restore
 *  or hard-delete. */
export function listArchivedSessions(): PersistedSession[] {
  return stmts().listArchived.all() as unknown as PersistedSession[];
}

/** Hard-delete a session row. The events FK cascade handles per-
 *  session event rows; the caller is responsible for removing any
 *  on-disk session directory (the SessionManager owns that path
 *  layout, not the SQL store). */
export function deleteSession(id: string): void {
  deleteSessionSourceFiles(id);
  stmts().deleteSideWorkspace.run(id);
  stmts().deleteRow.run(id);
}

export function pinSession(id: string, at: number = Date.now()): void {
  stmts().pin.run(at, id);
  writeSessionMetadata(id);
}

export function unpinSession(id: string): void {
  stmts().unpin.run(id);
  writeSessionMetadata(id);
}

export function listSessions(limit = 200): PersistedSession[] {
  return stmts().list.all(limit) as unknown as PersistedSession[];
}

/** All non-archived sessions ordered for the Sidebar (Pinned first,
 *  then Chats by recency). */
export function listSessionsForSidebar(): PersistedSession[] {
  return stmts().listForSidebar.all() as unknown as PersistedSession[];
}

// -------------------- task side workspaces --------------------

export function saveSideWorkspace(row: {
  task_id: string;
  state_json: string;
}): void {
  if (!row.task_id || !row.state_json) return;
  stmts().saveSideWorkspace.run(row.task_id, row.state_json, Date.now());
}

export function listSideWorkspaces(): PersistedSideWorkspace[] {
  return stmts().listSideWorkspaces.all() as unknown as PersistedSideWorkspace[];
}

export function deleteSideWorkspace(task_id: string): void {
  if (!task_id) return;
  stmts().deleteSideWorkspace.run(task_id);
}

// -------------------- projects --------------------

type PersistedProjectSqlRow = {
  id: string;
  name: string;
  source_folders_json: string;
  primary_folder: string;
  created_at: number;
  updated_at: number;
};

function projectFromSql(row: PersistedProjectSqlRow): ProjectInfo {
  let sourceFolders: string[] = [];
  try {
    const parsed = JSON.parse(row.source_folders_json);
    if (Array.isArray(parsed)) {
      sourceFolders = parsed.filter((value): value is string =>
        typeof value === "string"
      );
    }
  } catch {
    sourceFolders = [];
  }
  const normalized = normalizeProjectFolders({
    source_folders: sourceFolders,
    primary_folder: row.primary_folder,
  });
  return {
    id: row.id,
    name: row.name,
    ...normalized,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function saveProject(row: {
  id: string;
  name: string;
  source_folders: string[];
  primary_folder?: string;
}): ProjectInfo {
  const normalized = normalizeProjectFolders(row);
  const now = Date.now();
  stmts().saveProject.run(
    row.id,
    row.name.trim(),
    JSON.stringify(normalized.source_folders),
    normalized.primary_folder,
    now,
    now,
  );
  return getProject(row.id)!;
}

export function getProject(id: string): ProjectInfo | null {
  const row = stmts().getProject.get(id) as PersistedProjectSqlRow | undefined;
  return row ? projectFromSql(row) : null;
}

export function listProjects(): ProjectInfo[] {
  return (stmts().listProjects.all() as PersistedProjectSqlRow[])
    .map(projectFromSql);
}

export function deleteProject(id: string): void {
  stmts().unlinkProjectSessions.run(id);
  stmts().deleteProject.run(id);
}

// -------------------- pair sessions --------------------

/** Create or rename a pair-chat wrapper row. The pair carries the
 *  sidebar title + cwd policy; its members live on `sessions` with
 *  `pair_id` pointing here. */
export function upsertPairSession(row: {
  id: string;
  title?: string;
  workspace_cwd?: string;
}): void {
  const now = Date.now();
  stmts().upsertPair.run(row.id, row.title ?? "", row.workspace_cwd ?? "", now, now);
  writePairSessionMetadata(row.id);
}

export function touchPairSession(id: string): void {
  stmts().touchPair.run(Date.now(), id);
  writePairSessionMetadata(id);
}

/** Seed the pair's sidebar title from the first user prompt — the same
 *  ergonomic the single-chat sidebar gets via setSessionTitleIfEmpty.
 *  Idempotent (no-op once a title is set). */
export function setPairTitleIfEmpty(id: string, title: string): void {
  if (!title) return;
  stmts().setPairTitleIfEmpty.run(title, id);
  writePairSessionMetadata(id);
}

export function pinPairSession(id: string, at: number = Date.now()): void {
  stmts().pinPair.run(at, id);
  writePairSessionMetadata(id);
}

export function unpinPairSession(id: string): void {
  stmts().unpinPair.run(id);
  writePairSessionMetadata(id);
}

export function archivePairSession(id: string): void {
  stmts().archivePair.run(Date.now(), id);
  writePairSessionMetadata(id);
}

export function unarchivePairSession(id: string): void {
  stmts().unarchivePair.run(id);
  writePairSessionMetadata(id);
}

export function getPairSession(id: string): PersistedPairSession | null {
  return (stmts().getPair.get(id) as unknown as PersistedPairSession | undefined) ?? null;
}

/** Sub-sessions of a pair, in creation order — that's the display order
 *  the grid uses (codex column then claude column, deterministic across
 *  reload). */
export function listPairMembers(pair_id: string): PersistedSession[] {
  return stmts().listPairMembers.all(pair_id) as unknown as PersistedSession[];
}

export interface PersistedPairGroup extends PersistedPairSession {
  members: PersistedSession[];
}

export function listPairGroups(): PersistedPairGroup[] {
  const pairs = stmts().listPairs.all() as unknown as PersistedPairSession[];
  return pairs.map((pair) => ({
    ...pair,
    members: listPairMembers(pair.id),
  }));
}

/** Persist renderer-owned pair grouping metadata. The member rows remain
 *  ordinary sessions; `pair_id` only hides them from the single-chat
 *  sidebar and lets pairsList rebuild the grid after restart. */
export function savePairGroup(row: {
  id: string;
  title?: string;
  workspace_cwd?: string;
  members: Array<{ id: string; agent_id: string; cwd?: string }>;
}): void {
  upsertPairSession({
    id: row.id,
    title: row.title,
    workspace_cwd: row.workspace_cwd,
  });
  for (const member of row.members) {
    upsertSession({
      id: member.id,
      agent_id: member.agent_id,
      cwd: member.cwd ?? row.workspace_cwd ?? "",
      pair_id: row.id,
    });
  }
}

// -------------------- events --------------------

export function appendEvent(
  session_id: string,
  type: string,
  data: unknown,
): void {
  const s = stmts();
  if (
    type === "openma_event"
    && data !== null
    && typeof data === "object"
    && !Array.isArray(data)
  ) {
    const eventId = (data as { event_id?: unknown }).event_id;
    if (
      typeof eventId === "string"
      && s.canonicalEventExists.get(session_id, eventId)
    ) {
      return;
    }
  }
  const ts = Date.now();
  const serialized = serializeJsonForSqlite(data);
  // Bind event JSON as UTF-8 bytes and cast inside SQLite. Electron 42's
  // node:sqlite Utf8Value path can abort the entire main process for external
  // V8 strings whose reported UTF-16 length disagrees with their UTF-8 byte
  // length (observed in Claude ACP config option descriptions). Binding a
  // Uint8Array avoids that native string conversion while CAST preserves the
  // TEXT storage contract consumed by history, FTS, and transcript rebuilds.
  s.appendEvent.run(session_id, type, serialized.bytes, ts);
  const row = s.sessionEventCount.get(session_id) as { count: number | bigint };
  writeTranscriptEvent(session_id, {
    seq: Number(row.count),
    type,
    ts,
    serializedData: serialized.bytes,
  });
}

/** Batch-append in a single transaction. node:sqlite doesn't ship a
 *  `db.transaction()` helper like better-sqlite3 did — but `BEGIN` +
 *  prepared statement reuse achieves the same throughput. */
export function appendEventsTx(
  session_id: string,
  rows: Array<{ type: string; data: unknown }>,
): void {
  if (!_db) throw new Error("session-store: openSessionDb() not called");
  if (rows.length === 0) return;
  const insert = stmts().appendEvent;
  const now = Date.now();
  _db.exec("BEGIN");
  try {
    for (const r of rows) {
      insert.run(
        session_id,
        r.type,
        serializeJsonForSqlite(r.data).bytes,
        now,
      );
    }
    _db.exec("COMMIT");
  } catch (e) {
    _db.exec("ROLLBACK");
    throw e;
  }
}

export function loadHistory(session_id: string): PersistedEvent[] {
  return stmts().loadHistory.all(session_id) as unknown as PersistedEvent[];
}

// -------------------- search --------------------

export interface SearchHit {
  session_id: string;
  session_title: string;
  agent_id: string;
  /** Event seq inside the session — lets the UI jump-scroll later. */
  seq: number;
  type: string;
  ts: number;
  /** FTS5 snippet — match highlighted with `⁨`/`⁩` braces; the
   *  renderer strips/replaces them for display. */
  snippet: string;
}

/** Full-text search across persisted prose events. Returns the top N
 *  matches with FTS5 BM25 ranking, joined with the session title so the
 *  Cmd+K palette can render "session label · matched line". Empty
 *  query returns []. */
export function searchMessages(query: string, limit = 20): SearchHit[] {
  if (!_db) throw new Error("session-store: openSessionDb() not called");
  const q = query.trim();
  if (!q) return [];
  // FTS5 MATCH syntax is its own thing — wrap each word with `*` for
  // prefix matching so partial typing finds things; quote with double
  // quotes to swallow user-typed punctuation that would otherwise be
  // parsed as operators (- means NOT, : is column-qualified, etc).
  const ftsQuery = q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, '""')}"*`)
    .join(" ");
  // Inline prepare — search is rare-ish and the query shape doesn't
  // benefit from caching the way per-row inserts do.
  const stmt = _db.prepare(`
    SELECT
      f.session_id,
      f.seq,
      f.type,
      f.ts,
      s.title          AS session_title,
      s.agent_id,
      snippet(messages_fts, 4, '⁨', '⁩', '…', 12) AS snippet
    FROM messages_fts f
    JOIN sessions s ON s.id = f.session_id
    WHERE messages_fts MATCH ?
    ORDER BY bm25(messages_fts), f.ts DESC
    LIMIT ?
  `);
  return stmt.all(ftsQuery, limit) as unknown as SearchHit[];
}

export function getActivityStats(): ActivityStatsInfo {
  if (!_db) throw new Error("session-store: openSessionDb() not called");
  return queryActivityStats(_db);
}

function writeTranscriptEvent(
  sessionId: string,
  event: { seq: number; type: string; ts: number; serializedData: Buffer },
): void {
  const root = _storageRoot;
  if (!root) throw new Error("session-store: storage root unavailable");
  const session = stmts().getSession.get(sessionId) as PersistedSession | undefined;
  if (!session) throw new Error(`session-store: missing session ${sessionId}`);

  const dir = join(root, "transcripts", ...dateParts(session.created_at));
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    join(dir, `${sessionId}.jsonl`),
    Buffer.concat([
      Buffer.from(
        `{"schema_version":"backchat.session_event.v1","seq":${event.seq},` +
          `"type":${JSON.stringify(event.type)},"ts":${event.ts},"data":`,
        "utf8",
      ),
      event.serializedData,
      Buffer.from(',"source":"desktop"}\n', "utf8"),
    ]),
  );
}

/**
 * Re-materialize adapter-owned strings before JSON encoding. Electron 42 can
 * expose strings parsed by an ACP child as external V8 strings whose reported
 * UTF-16 length is inconsistent with their UTF-8 byte length. Passing the
 * resulting JSON string directly to node:sqlite either aborts in Utf8Value or
 * yields bytes that SQLite's JSON trigger rejects as `malformed JSON`.
 *
 * A UTF-8 round trip in the JSON replacer gives every value an ordinary V8
 * string before JSON.stringify assembles the final document. The returned
 * string is then safe to bind as bytes and reuse verbatim in the transcript.
 */
function serializeJsonForSqlite(value: unknown): { bytes: Buffer } {
  const bytes = encodeJsonValue(value, new Set());
  if (!bytes) {
    throw new TypeError("session-store: event payload is not JSON serializable");
  }
  // Fail in JavaScript before SQLite triggers see a partial document. This
  // also protects the canonical de-dup query from accumulating bad rows.
  JSON.parse(bytes.toString("utf8"));
  return { bytes };
}

/** Encode JSON as small stable tokens instead of materializing one large V8
 * string. This preserves JSON.stringify semantics for the protocol payloads
 * we persist while avoiding Electron 42's broken external-string conversion
 * on the assembled document. */
function encodeJsonValue(
  input: unknown,
  ancestors: Set<object>,
  key = "",
): Buffer | undefined {
  let value = input;
  if (
    value !== null
    && typeof value === "object"
    && typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    value = (value as { toJSON: (key: string) => unknown }).toJSON(key);
  }

  if (value === null) return Buffer.from("null");
  if (typeof value === "string") return encodeJsonString(value);
  if (typeof value === "boolean") return Buffer.from(value ? "true" : "false");
  if (typeof value === "number") {
    return Buffer.from(Number.isFinite(value) ? String(value) : "null");
  }
  if (typeof value === "bigint") {
    throw new TypeError("Do not know how to serialize a BigInt");
  }
  if (
    value === undefined
    || typeof value === "function"
    || typeof value === "symbol"
  ) {
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  if (ancestors.has(value)) {
    throw new TypeError("Converting circular structure to JSON");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const chunks: Buffer[] = [Buffer.from("[")];
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) chunks.push(Buffer.from(","));
        chunks.push(
          encodeJsonValue(value[index], ancestors, String(index))
            ?? Buffer.from("null"),
        );
      }
      chunks.push(Buffer.from("]"));
      return Buffer.concat(chunks);
    }

    const chunks: Buffer[] = [Buffer.from("{")];
    let count = 0;
    for (const property of Object.keys(value)) {
      const encoded = encodeJsonValue(
        (value as Record<string, unknown>)[property],
        ancestors,
        property,
      );
      if (!encoded) continue;
      if (count > 0) chunks.push(Buffer.from(","));
      chunks.push(
        encodeJsonString(property),
        Buffer.from(":"),
        encoded,
      );
      count += 1;
    }
    chunks.push(Buffer.from("}"));
    return Buffer.concat(chunks);
  } finally {
    ancestors.delete(value);
  }
}

function encodeJsonString(value: string): Buffer {
  // Iteration copies adapter-owned external strings one code point at a time.
  // JSON.stringify only sees the resulting ordinary string token.
  const normalized = Array.from(value).join("");
  const quoted = JSON.stringify(normalized);
  return Buffer.from(Array.from(quoted).join(""), "utf8");
}

function writeSessionMetadata(sessionId: string): void {
  const root = _storageRoot;
  if (!root) throw new Error("session-store: storage root unavailable");
  const session = stmts().getSession.get(sessionId) as PersistedSession | undefined;
  if (!session) return;

  const dir = join(root, "transcripts", ...dateParts(session.created_at));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.meta.toml`),
    toToml({
      schema_version: "backchat.session_meta.v1",
      session_id: session.id,
      agent_id: session.agent_id,
      acp_session_id: session.acp_session_id,
      title: session.title,
      title_manually_set: session.title_manually_set,
      created_at: session.created_at,
      last_used_at: session.last_used_at,
      pair_id: session.pair_id ?? "",
      project_id: session.project_id ?? "",
      workdir: session.cwd,
    }) + "\n",
    "utf-8",
  );
}

function deleteSessionSourceFiles(sessionId: string): void {
  const root = _storageRoot;
  if (!root) throw new Error("session-store: storage root unavailable");
  const session = stmts().getSession.get(sessionId) as PersistedSession | undefined;
  if (!session) return;

  const dir = join(root, "transcripts", ...dateParts(session.created_at));
  rmSync(join(dir, `${sessionId}.jsonl`), { force: true });
  rmSync(join(dir, `${sessionId}.meta.toml`), { force: true });
}

function writePairSessionMetadata(pairId: string): void {
  const root = _storageRoot;
  if (!root) throw new Error("session-store: storage root unavailable");
  const pair = stmts().getPair.get(pairId) as PersistedPairSession | undefined;
  if (!pair) return;

  const dir = join(root, "transcripts", ...dateParts(pair.created_at));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${pairId}.pair.meta.toml`),
    toToml({
      schema_version: "backchat.pair_session_meta.v1",
      pair_id: pair.id,
      title: pair.title,
      workspace_cwd: pair.workspace_cwd,
      created_at: pair.created_at,
      last_used_at: pair.last_used_at,
    }) + "\n",
    "utf-8",
  );
}

function dateParts(ms: number): [string, string, string] {
  const d = new Date(ms);
  return [
    String(d.getUTCFullYear()),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ];
}

function deriveStorageRoot(dbPath: string): string {
  const dir = dirname(dbPath);
  return basename(dir) === "indexes" ? dirname(dir) : dir;
}
