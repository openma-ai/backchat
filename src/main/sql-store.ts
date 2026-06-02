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
 * Two tables in `userData/sessions.db`:
 *
 *   sessions      one row per chat the user has opened
 *   events        append-only log of ACP session updates for replay
 *
 * Why two tables, not one JSON blob: chat history grows unbounded and
 * single-row updates would force a full re-serialize on every chunk. The
 * events table lets us append-only and replay by session_id ORDER BY seq
 * — same shape openma uses for its main event log (see packages/event-log
 * in the OSS repo).
 *
 * Persistence model:
 *   - text chunks: NOT stored individually (tens of thousands per long
 *     turn). On turn complete we write a single `agent_message` event
 *     with the full assistantText and a single `agent_thought` for the
 *     full thoughtText.
 *   - tool_call / tool_call_update: stored as-arrived. Low-frequency and
 *     patch semantics need them preserved.
 *   - user prompts: stored as `user_prompt` events.
 *
 * We never write while the ACP child is mid-stream — that would compete
 * with the renderer's hot path. Writes happen on turn complete / error /
 * cancel, in a single transaction.
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface PersistedSession {
  id: string;
  agent_id: string;
  cwd: string;
  acp_session_id: string;
  title: string;
  last_used_at: number;
  created_at: number;
  archived_at: number | null;
}

export interface PersistedEvent {
  seq: number;
  session_id: string;
  type: string;
  /** JSON-serialized payload — parse at the read site. */
  data: string;
  ts: number;
}

let _db: DatabaseSync | null = null;
// Prepared statement cache — node:sqlite recommends preparing once and
// reusing. The cache also keeps the underlying StatementSync handles
// alive for the process lifetime; we never need to finalize them.
let _stmts: {
  upsert: StatementSync;
  touch: StatementSync;
  setTitle: StatementSync;
  archive: StatementSync;
  list: StatementSync;
  appendEvent: StatementSync;
  loadHistory: StatementSync;
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
      last_used_at  INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      archived_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS sessions_last_used_idx
      ON sessions(archived_at, last_used_at DESC);

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
  `);

  _db = db;
  _stmts = {
    upsert: db.prepare(`
      INSERT INTO sessions (id, agent_id, cwd, acp_session_id, title, last_used_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        agent_id       = excluded.agent_id,
        cwd            = excluded.cwd,
        acp_session_id = CASE WHEN excluded.acp_session_id != ''
                              THEN excluded.acp_session_id
                              ELSE sessions.acp_session_id END,
        title          = CASE WHEN excluded.title != ''
                              THEN excluded.title
                              ELSE sessions.title END,
        last_used_at   = excluded.last_used_at
    `),
    touch: db.prepare(`UPDATE sessions SET last_used_at = ? WHERE id = ?`),
    setTitle: db.prepare(`UPDATE sessions SET title = ? WHERE id = ?`),
    archive: db.prepare(`UPDATE sessions SET archived_at = ? WHERE id = ?`),
    list: db.prepare(`
      SELECT * FROM sessions
      WHERE archived_at IS NULL
      ORDER BY last_used_at DESC
      LIMIT ?
    `),
    appendEvent: db.prepare(
      `INSERT INTO events (session_id, type, data, ts) VALUES (?, ?, ?, ?)`,
    ),
    loadHistory: db.prepare(
      `SELECT * FROM events WHERE session_id = ? ORDER BY seq ASC`,
    ),
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
  );
}

export function touchSession(id: string): void {
  stmts().touch.run(Date.now(), id);
}

export function setSessionTitle(id: string, title: string): void {
  stmts().setTitle.run(title, id);
}

export function archiveSession(id: string): void {
  stmts().archive.run(Date.now(), id);
}

export function listSessions(limit = 200): PersistedSession[] {
  return stmts().list.all(limit) as unknown as PersistedSession[];
}

// -------------------- events --------------------

export function appendEvent(
  session_id: string,
  type: string,
  data: unknown,
): void {
  stmts().appendEvent.run(session_id, type, JSON.stringify(data), Date.now());
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
    for (const r of rows) insert.run(session_id, r.type, JSON.stringify(r.data), now);
    _db.exec("COMMIT");
  } catch (e) {
    _db.exec("ROLLBACK");
    throw e;
  }
}

export function loadHistory(session_id: string): PersistedEvent[] {
  return stmts().loadHistory.all(session_id) as unknown as PersistedEvent[];
}
