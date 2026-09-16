import type { OpenmaScope, OpenmaTask, OpenmaTaskEvent, OpenmaTaskOperation, OpenmaTaskSearchHit } from "../shared/openma.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openmaScopeKey } from "./openma-identity.js";
export { openmaScopeKey } from "./openma-identity.js";
function targetKey(task: OpenmaTask): string {
  return JSON.stringify([openmaScopeKey(task), task.sessionId, task.target.kind, task.target.agentId, task.target.environmentId, task.target.runtimeId]);
}

export class OpenmaTaskStore {
  #db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, remote_id TEXT NOT NULL,
        data TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, UNIQUE(scope, remote_id)
      );
      CREATE TABLE IF NOT EXISTS events (
        task_id TEXT NOT NULL REFERENCES tasks(id), key TEXT NOT NULL, seq INTEGER,
        data TEXT NOT NULL, PRIMARY KEY(task_id, key), UNIQUE(task_id, seq)
      );
      CREATE TABLE IF NOT EXISTS operations (
        task_id TEXT NOT NULL REFERENCES tasks(id), id TEXT NOT NULL, event TEXT NOT NULL,
        state TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(task_id, id)
      );
      CREATE TABLE IF NOT EXISTS preferences (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id), pinned_at INTEGER, archived_at INTEGER
      );
      UPDATE operations SET state = 'uncertain' WHERE state = 'pending';`);
  }
  save(task: OpenmaTask): void {
    const previous = this.get(task.id);
    if (previous && targetKey(previous) !== targetKey(task)) throw new Error("A task's execution target cannot change");
    const { pinnedAt: _pin, archivedAt: _archive, revision: _revision, ...remote } = task;
    this.#db.prepare(`INSERT INTO tasks VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
      .run(task.id, openmaScopeKey(task), task.sessionId, JSON.stringify({ ...remote, revision: (previous?.revision ?? 0) + 1 }), previous?.afterSeq ?? task.afterSeq);
  }
  get(id: string): OpenmaTask | null {
    const row = this.#db.prepare("SELECT data, cursor FROM tasks WHERE id = ?").get(id) as { data: string; cursor: number } | undefined;
    const preferences = this.#db.prepare("SELECT pinned_at, archived_at FROM preferences WHERE task_id = ?").get(id) as { pinned_at: number | null; archived_at: number | null } | undefined;
    return row ? { ...JSON.parse(row.data), afterSeq: row.cursor,
      ...(preferences ? { pinnedAt: preferences.pinned_at, archivedAt: preferences.archived_at } : {}),
    } as OpenmaTask : null;
  }
  setPreferences(id: string, patch: { pinned?: boolean; archived?: boolean }, now = Date.now()): void {
    const task = this.get(id);
    if (!task) throw new Error("OpenMA task does not exist");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare(`INSERT INTO preferences VALUES (?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET
        pinned_at = excluded.pinned_at, archived_at = excluded.archived_at`).run(id,
        patch.pinned === undefined ? task.pinnedAt ?? null : patch.pinned ? task.pinnedAt ?? now : null,
        patch.archived === undefined ? task.archivedAt ?? null : patch.archived ? task.archivedAt ?? now : null);
      this.#db.prepare("UPDATE tasks SET data = json_set(data, '$.revision', COALESCE(json_extract(data, '$.revision'), 0) + 1) WHERE id = ?").run(id);
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }
  list(scope: OpenmaScope): OpenmaTask[] {
    const rows = this.#db.prepare("SELECT id FROM tasks WHERE scope = ?").all(openmaScopeKey(scope)) as Array<{ id: string }>;
    return rows.map((row) => this.get(row.id)!).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  search(scope: OpenmaScope, query: string, limit: number): OpenmaTaskSearchHit[] {
    const term = query.trim();
    if (!term) return [];
    const rows = this.#db.prepare(`WITH prose AS (
      SELECT id AS task_id, 0 AS seq, 'title' AS type, json_extract(data, '$.updatedAt') AS ts,
        json_extract(data, '$.title') AS text FROM tasks WHERE scope = ?
      UNION ALL
      SELECT t.id, COALESCE(e.seq, 0), json_extract(e.data, '$.type'), json_extract(t.data, '$.updatedAt'),
        CASE json_type(e.data, '$.content')
          WHEN 'text' THEN json_extract(e.data, '$.content')
          WHEN 'array' THEN (SELECT group_concat(CASE WHEN b.type = 'object' THEN
            COALESCE(json_extract(b.value, '$.text'), json_extract(b.value, '$.thinking'), '') ELSE '' END, '') FROM json_each(e.data, '$.content') b)
          ELSE COALESCE(json_extract(e.data, '$.thinking'), '') END
      FROM events e JOIN tasks t ON t.id = e.task_id
      WHERE t.scope = ? AND json_extract(e.data, '$.type') IN ('user.message', 'agent.message', 'agent.thinking')
    ) SELECT * FROM prose WHERE instr(lower(text), lower(?)) > 0 ORDER BY ts DESC, seq DESC LIMIT ?`)
      .all(openmaScopeKey(scope), openmaScopeKey(scope), term, Math.min(100, Math.max(1, limit))) as Array<{ task_id: string; seq: number; type: string; ts: number; text: string }>;
    return rows.map((row) => {
      const offset = row.text.toLowerCase().indexOf(term.toLowerCase());
      const start = Math.max(0, offset - 70);
      const end = Math.min(row.text.length, offset + term.length + 90);
      const snippet = `${start ? "…" : ""}${row.text.slice(start, offset)}\u2068${row.text.slice(offset, offset + term.length)}\u2069${row.text.slice(offset + term.length, end)}${end < row.text.length ? "…" : ""}`;
      return { task: this.get(row.task_id)!, seq: row.seq, type: row.type, ts: row.ts, snippet };
    });
  }
  append(id: string, event: OpenmaTaskEvent): boolean {
    const seq = Number.isSafeInteger(event.seq) && event.seq! > 0 ? event.seq! : null;
    if (!event.id && seq === null) return false;
    const key = event.id ? `id:${event.id}` : `seq:${seq}`;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.#db.prepare("SELECT key, seq FROM events WHERE task_id = ? AND (key = ? OR (seq IS NOT NULL AND seq = ?))").get(id, key, seq) as { key: string; seq: number | null } | undefined;
      if (prior?.seq !== null && prior?.seq !== undefined && seq !== null && prior.seq !== seq) throw new Error("OpenMA event sequence changed");
      if (prior && prior.key !== key && prior.key.startsWith("id:") && key.startsWith("id:")) throw new Error("OpenMA event sequence conflicts with another event");
      const enrich = prior && ((prior.seq === null && seq !== null) || (prior.key.startsWith("seq:") && key.startsWith("id:")));
      const result = enrich
        ? this.#db.prepare("UPDATE events SET key = ?, seq = ?, data = ? WHERE task_id = ? AND key = ?").run(key, seq, JSON.stringify(event), id, prior.key)
        : this.#db.prepare("INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?)").run(id, key, seq, JSON.stringify(event));
      if (seq !== null) this.#db.prepare("UPDATE tasks SET cursor = MAX(cursor, ?) WHERE id = ?").run(seq, id);
      if (event.id) this.#db.prepare("UPDATE operations SET state = 'reconciled' WHERE task_id = ? AND json_extract(event, '$.id') = ?").run(id, event.id);
      const metadata = event.metadata as Record<string, unknown> | undefined;
      const operationId = metadata?.["backchat.operation_id"];
      if (typeof operationId === "string") this.#db.prepare("UPDATE operations SET state = 'reconciled' WHERE task_id = ? AND id = ?").run(id, operationId);
      this.#db.exec("COMMIT");
      return result.changes > 0;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }
  events(id: string): OpenmaTaskEvent[] {
    return (this.#db.prepare("SELECT data FROM events WHERE task_id = ? ORDER BY seq NULLS LAST, rowid").all(id) as Array<{ data: string }>).map((row) => JSON.parse(row.data));
  }
  beginOperation(id: string, operationId: string, event: OpenmaTaskEvent): boolean {
    return this.#db.prepare("INSERT OR IGNORE INTO operations VALUES (?, ?, ?, 'pending', ?)").run(id, operationId, JSON.stringify(event), Date.now()).changes > 0;
  }
  settleOperation(id: string, operationId: string, state: "accepted" | "uncertain"): void {
    this.#db.prepare("UPDATE operations SET state = ? WHERE task_id = ? AND id = ? AND state != 'reconciled'").run(state, id, operationId);
  }
  operations(id: string): OpenmaTaskOperation[] {
    return (this.#db.prepare("SELECT * FROM operations WHERE task_id = ? AND state != 'reconciled' ORDER BY created_at").all(id) as Array<{ id: string; event: string; state: OpenmaTaskOperation["state"]; created_at: number }>).map((row) => ({ id: row.id, event: JSON.parse(row.event), state: row.state, createdAt: row.created_at }));
  }
  close(): void { this.#db.close(); }
}
