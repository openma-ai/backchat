import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface RunnerDelivery { stream_id: string; seq: number }
export type RunnerOutput = Record<string, unknown> & { session_id: string; tenant_id: string };
export type DeliveredRunnerOutput = RunnerOutput & { delivery: RunnerDelivery };

/** Output is committed locally before socket.send and removed only by a scoped,
 * cumulative relay acknowledgement. Stream counters outlive the pending rows. */
export class OpenmaRunnerOutbox {
  #db: DatabaseSync;
  #scope: string;
  constructor(path: string, scope: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.#scope = scope;
    this.#db.exec(`PRAGMA foreign_keys = ON;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS streams (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, tenant TEXT NOT NULL,
        session TEXT NOT NULL, head INTEGER NOT NULL DEFAULT 0,
        UNIQUE(scope, tenant, session)
      );
      CREATE TABLE IF NOT EXISTS frames (
        stream TEXT NOT NULL REFERENCES streams(id), seq INTEGER NOT NULL,
        body TEXT NOT NULL, UNIQUE(stream, seq)
      );`);
  }
  append(frame: RunnerOutput): DeliveredRunnerOutput {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("INSERT OR IGNORE INTO streams (id, scope, tenant, session) VALUES (?, ?, ?, ?)")
        .run(randomUUID(), this.#scope, frame.tenant_id, frame.session_id);
      const stream = this.#db.prepare("UPDATE streams SET head = head + 1 WHERE scope = ? AND tenant = ? AND session = ? RETURNING id, head")
        .get(this.#scope, frame.tenant_id, frame.session_id) as { id: string; head: number };
      const result = { ...frame, delivery: { stream_id: stream.id, seq: stream.head } };
      this.#db.prepare("INSERT INTO frames VALUES (?, ?, ?)").run(stream.id, stream.head, JSON.stringify(result));
      this.#db.exec("COMMIT");
      return result;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }
  pending(): DeliveredRunnerOutput[] {
    return (this.#db.prepare(`SELECT body FROM frames JOIN streams ON streams.id = frames.stream
      WHERE streams.scope = ? ORDER BY frames.rowid`).all(this.#scope) as Array<{ body: string }>).map((row) => JSON.parse(row.body));
  }
  acknowledge(frame: Record<string, unknown>, legacy = false): void {
    const delivery = frame.delivery as Partial<RunnerDelivery> | undefined;
    if (!delivery || typeof delivery.stream_id !== "string" || !Number.isSafeInteger(delivery.seq) || delivery.seq! <= 0
      || typeof frame.session_id !== "string" || typeof frame.tenant_id !== "string") return;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare(`DELETE FROM frames WHERE seq <= ? AND stream IN (
        SELECT id FROM streams WHERE id = ? AND scope = ? AND tenant = ? AND session = ? AND head >= ?
      )`).run(delivery.seq!, delivery.stream_id, this.#scope, frame.tenant_id, frame.session_id, delivery.seq!);
      // Legacy services never stored the sequence. Start a fresh stream once
      // that batch drains, so upgrading the relay cannot introduce a gap.
      if (legacy) this.#db.prepare(`DELETE FROM streams WHERE id = ? AND scope = ? AND tenant = ? AND session = ? AND head = ?
        AND NOT EXISTS (SELECT 1 FROM frames WHERE stream = streams.id)`)
        .run(delivery.stream_id, this.#scope, frame.tenant_id, frame.session_id, delivery.seq!);
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }
  close(): void { this.#db.close(); }
}
