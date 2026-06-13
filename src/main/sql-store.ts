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
 * Two tables in `~/.openma/sessions.db`:
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
  pinned_at: number | null;
  /** When this session is a sub-member of a pair-chat, the wrapper pair
   *  row's id. Sidebar lists hide rows with `pair_id != null` and shows
   *  the pair row instead. */
  pair_id: string | null;
}

export interface PersistedPairSession {
  id: string;
  title: string;
  /** When non-empty, every member of the pair spawns in this cwd. When
   *  empty, each member gets an isolated `~/.openma/sessions/<member>/`
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
  unarchive: StatementSync;
  pin: StatementSync;
  unpin: StatementSync;
  list: StatementSync;
  listArchived: StatementSync;
  listForSidebar: StatementSync;
  deleteRow: StatementSync;
  appendEvent: StatementSync;
  loadHistory: StatementSync;
  // Pair-chat helpers — see PersistedPairSession + pair_sessions schema.
  upsertPair: StatementSync;
  touchPair: StatementSync;
  setPairTitleIfEmpty: StatementSync;
  getPair: StatementSync;
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
      last_used_at  INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      archived_at   INTEGER,
      pinned_at     INTEGER,
      pair_id       TEXT
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
    --                            ~/.openma/sessions/<sub_id>/
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
    CREATE TRIGGER IF NOT EXISTS events_ai_fts AFTER INSERT ON events
    WHEN new.type IN ('user_prompt', 'agent_message', 'agent_thought')
    BEGIN
      INSERT INTO messages_fts(session_id, seq, type, ts, text)
      VALUES (new.session_id, new.seq, new.type, new.ts, json_extract(new.data, '$.text'));
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
  db.exec(`
    CREATE INDEX IF NOT EXISTS sessions_pinned_idx
      ON sessions(archived_at, pinned_at DESC);
    CREATE INDEX IF NOT EXISTS sessions_pair_idx
      ON sessions(pair_id);
  `);

  _db = db;
  _stmts = {
    upsert: db.prepare(`
      INSERT INTO sessions (id, agent_id, cwd, acp_session_id, title, last_used_at, created_at, pair_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        agent_id       = excluded.agent_id,
        cwd            = excluded.cwd,
        acp_session_id = CASE WHEN excluded.acp_session_id != ''
                              THEN excluded.acp_session_id
                              ELSE sessions.acp_session_id END,
        title          = CASE WHEN excluded.title != ''
                              THEN excluded.title
                              ELSE sessions.title END,
        last_used_at   = excluded.last_used_at,
        pair_id        = COALESCE(excluded.pair_id, sessions.pair_id)
    `),
    touch: db.prepare(`UPDATE sessions SET last_used_at = ? WHERE id = ?`),
    setTitle: db.prepare(`UPDATE sessions SET title = ? WHERE id = ?`),
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
      `INSERT INTO events (session_id, type, data, ts) VALUES (?, ?, ?, ?)`,
    ),
    loadHistory: db.prepare(
      `SELECT * FROM events WHERE session_id = ? ORDER BY seq ASC`,
    ),
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
    getPair: db.prepare(`SELECT * FROM pair_sessions WHERE id = ?`),
    listPairMembers: db.prepare(
      `SELECT * FROM sessions WHERE pair_id = ? ORDER BY created_at ASC`,
    ),
  };

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
  );
}

export function touchSession(id: string): void {
  stmts().touch.run(Date.now(), id);
}

export function setSessionTitle(id: string, title: string): void {
  stmts().setTitle.run(title, id);
}

/** Conditional version — only writes the title if the row's current
 *  title is empty. Lets the first user prompt seed a sensible label
 *  without overwriting whatever the user may have later renamed it to. */
export function setSessionTitleIfEmpty(id: string, title: string): void {
  const rows = stmts().list.all(2000) as unknown as PersistedSession[];
  const row = rows.find((r) => r.id === id);
  if (!row || row.title) return;
  stmts().setTitle.run(title, id);
}

export function archiveSession(id: string): void {
  stmts().archive.run(Date.now(), id);
}

export function unarchiveSession(id: string): void {
  stmts().unarchive.run(id);
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
  stmts().deleteRow.run(id);
}

export function pinSession(id: string, at: number = Date.now()): void {
  stmts().pin.run(at, id);
}

export function unpinSession(id: string): void {
  stmts().unpin.run(id);
}

export function listSessions(limit = 200): PersistedSession[] {
  return stmts().list.all(limit) as unknown as PersistedSession[];
}

/** All non-archived sessions ordered for the Sidebar (Pinned first,
 *  then Chats by recency). */
export function listSessionsForSidebar(): PersistedSession[] {
  return stmts().listForSidebar.all() as unknown as PersistedSession[];
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
}

export function touchPairSession(id: string): void {
  stmts().touchPair.run(Date.now(), id);
}

/** Seed the pair's sidebar title from the first user prompt — the same
 *  ergonomic the single-chat sidebar gets via setSessionTitleIfEmpty.
 *  Idempotent (no-op once a title is set). */
export function setPairTitleIfEmpty(id: string, title: string): void {
  if (!title) return;
  stmts().setPairTitleIfEmpty.run(title, id);
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
    WHERE messages_fts MATCH ? AND s.archived_at IS NULL
    ORDER BY bm25(messages_fts), f.ts DESC
    LIMIT ?
  `);
  return stmt.all(ftsQuery, limit) as unknown as SearchHit[];
}
