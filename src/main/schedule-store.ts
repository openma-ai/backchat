import { randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import type {
  CreateScheduleInput,
  ScheduleInfo,
  ScheduleNotificationPolicy,
  ScheduleRunInfo,
  ScheduleStatus,
  ScheduleTarget,
  ScheduleTrigger,
  UpdateScheduleInput,
} from "../shared/schedules.js";
import { nextScheduleRun } from "./schedule-trigger.js";

interface ScheduleRow {
  id: string;
  name: string;
  prompt: string;
  trigger_json: string;
  target: ScheduleTarget;
  status: ScheduleStatus;
  notification_policy: ScheduleNotificationPolicy;
  source_session_id: string;
  agent_id: string;
  cwd: string;
  created_at: number;
  updated_at: number;
  next_run_at: number | null;
  last_run_at: number | null;
}

interface ScheduleRunRow {
  id: string;
  schedule_id: string;
  scheduled_for: number;
  started_at: number;
  finished_at: number | null;
  status: ScheduleRunInfo["status"];
  session_id: string | null;
  error: string | null;
}

interface ScheduleStatements {
  insert: StatementSync;
  list: StatementSync;
  get: StatementSync;
  update: StatementSync;
  due: StatementSync;
  advance: StatementSync;
  insertRun: StatementSync;
  finishRun: StatementSync;
  listRuns: StatementSync;
  delete: StatementSync;
}

export class ScheduleStore {
  readonly #db: DatabaseSync;
  readonly #statements: ScheduleStatements;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA synchronous = NORMAL");
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        prompt              TEXT NOT NULL,
        trigger_json        TEXT NOT NULL,
        target              TEXT NOT NULL,
        status              TEXT NOT NULL,
        notification_policy TEXT NOT NULL,
        source_session_id   TEXT NOT NULL,
        agent_id            TEXT NOT NULL,
        cwd                 TEXT NOT NULL,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        next_run_at         INTEGER,
        last_run_at         INTEGER
      );
      CREATE INDEX IF NOT EXISTS schedules_due_idx
        ON schedules(status, next_run_at);
      CREATE TABLE IF NOT EXISTS schedule_runs (
        id            TEXT PRIMARY KEY,
        schedule_id   TEXT NOT NULL,
        scheduled_for INTEGER NOT NULL,
        started_at    INTEGER NOT NULL,
        finished_at   INTEGER,
        status        TEXT NOT NULL,
        session_id    TEXT,
        error         TEXT,
        FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS schedule_runs_schedule_idx
        ON schedule_runs(schedule_id, started_at DESC);
    `);
    this.#statements = {
      insert: this.#db.prepare(`
        INSERT INTO schedules (
          id, name, prompt, trigger_json, target, status,
          notification_policy, source_session_id, agent_id, cwd,
          created_at, updated_at, next_run_at, last_run_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      list: this.#db.prepare(`SELECT * FROM schedules ORDER BY created_at DESC`),
      get: this.#db.prepare(`SELECT * FROM schedules WHERE id = ?`),
      update: this.#db.prepare(`
        UPDATE schedules SET
          name = ?, prompt = ?, trigger_json = ?, target = ?, status = ?,
          notification_policy = ?, updated_at = ?, next_run_at = ?
        WHERE id = ?
      `),
      due: this.#db.prepare(`
        SELECT * FROM schedules
        WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?
        ORDER BY next_run_at ASC
      `),
      advance: this.#db.prepare(`
        UPDATE schedules SET
          status = ?, updated_at = ?, next_run_at = ?, last_run_at = ?
        WHERE id = ? AND status = 'active' AND next_run_at = ?
      `),
      insertRun: this.#db.prepare(`
        INSERT INTO schedule_runs (
          id, schedule_id, scheduled_for, started_at, finished_at,
          status, session_id, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      finishRun: this.#db.prepare(`
        UPDATE schedule_runs SET
          status = ?, session_id = ?, error = ?, finished_at = ?
        WHERE id = ? AND status = 'running'
      `),
      listRuns: this.#db.prepare(`
        SELECT * FROM schedule_runs
        WHERE schedule_id = ?
        ORDER BY started_at DESC
      `),
      delete: this.#db.prepare(`DELETE FROM schedules WHERE id = ?`),
    };
  }

  create(input: CreateScheduleInput): ScheduleInfo {
    const now = Date.now();
    const nextRunAt = nextScheduleRun(input.trigger, now, now);
    if (nextRunAt === null) throw new Error("Schedule has no future run");
    const row: ScheduleRow = {
      id: randomUUID(),
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      trigger_json: JSON.stringify(input.trigger),
      target: input.target,
      status: "active",
      notification_policy: input.notificationPolicy ?? "always",
      source_session_id: input.sourceSessionId,
      agent_id: input.agentId,
      cwd: input.cwd,
      created_at: now,
      updated_at: now,
      next_run_at: nextRunAt,
      last_run_at: null,
    };
    if (!row.name || !row.prompt || !row.source_session_id || !row.agent_id) {
      throw new Error("Schedule name, prompt, source task, and harness are required");
    }
    this.#statements.insert.run(
      row.id,
      row.name,
      row.prompt,
      row.trigger_json,
      row.target,
      row.status,
      row.notification_policy,
      row.source_session_id,
      row.agent_id,
      row.cwd,
      row.created_at,
      row.updated_at,
      row.next_run_at,
      row.last_run_at,
    );
    return fromScheduleRow(row);
  }

  list(): ScheduleInfo[] {
    return (this.#statements.list.all() as unknown as ScheduleRow[]).map(fromScheduleRow);
  }

  get(id: string): ScheduleInfo | null {
    const row = this.#statements.get.get(id) as unknown as ScheduleRow | undefined;
    return row ? fromScheduleRow(row) : null;
  }

  update(input: UpdateScheduleInput): ScheduleInfo {
    const current = this.get(input.id);
    if (!current) throw new Error(`Unknown schedule: ${input.id}`);
    const now = Date.now();
    const trigger = input.trigger ?? current.trigger;
    const status = input.status ?? current.status;
    const nextRunAt = status === "active"
      ? nextScheduleRun(trigger, now, now)
      : null;
    if (status === "active" && nextRunAt === null) {
      throw new Error("Schedule has no future run");
    }
    const updated: ScheduleInfo = {
      ...current,
      name: input.name?.trim() || current.name,
      prompt: input.prompt?.trim() || current.prompt,
      trigger,
      target: input.target ?? current.target,
      status,
      notificationPolicy: input.notificationPolicy ?? current.notificationPolicy,
      updatedAt: now,
      nextRunAt,
    };
    this.#statements.update.run(
      updated.name,
      updated.prompt,
      JSON.stringify(updated.trigger),
      updated.target,
      updated.status,
      updated.notificationPolicy,
      updated.updatedAt,
      updated.nextRunAt,
      updated.id,
    );
    return updated;
  }

  due(at = Date.now()): ScheduleInfo[] {
    return (this.#statements.due.all(at) as unknown as ScheduleRow[]).map(fromScheduleRow);
  }

  beginRun(scheduleId: string, at = Date.now()): {
    schedule: ScheduleInfo;
    run: ScheduleRunInfo;
  } | null {
    const current = this.get(scheduleId);
    if (
      !current ||
      current.status !== "active" ||
      current.nextRunAt === null ||
      current.nextRunAt > at
    ) {
      return null;
    }
    const scheduledFor = current.nextRunAt;
    const nextRunAt = nextScheduleRun(
      current.trigger,
      Math.max(scheduledFor, at),
      current.createdAt,
    );
    const status: ScheduleStatus = nextRunAt === null ? "completed" : "active";
    const run: ScheduleRunInfo = {
      id: randomUUID(),
      scheduleId,
      scheduledFor,
      startedAt: at,
      finishedAt: null,
      status: "running",
      sessionId: null,
      error: null,
    };
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const advanced = this.#statements.advance.run(
        status,
        at,
        nextRunAt,
        scheduledFor,
        current.id,
        scheduledFor,
      );
      if (Number(advanced.changes) !== 1) {
        this.#db.exec("ROLLBACK");
        return null;
      }
      this.#statements.insertRun.run(
        run.id,
        run.scheduleId,
        run.scheduledFor,
        run.startedAt,
        run.finishedAt,
        run.status,
        run.sessionId,
        run.error,
      );
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return {
      schedule: {
        ...current,
        status,
        updatedAt: at,
        nextRunAt,
        lastRunAt: scheduledFor,
      },
      run,
    };
  }

  finishRun(
    runId: string,
    result: {
      status: "succeeded" | "failed";
      sessionId?: string | null;
      error?: string | null;
    },
  ): void {
    this.#statements.finishRun.run(
      result.status,
      result.sessionId ?? null,
      result.error ?? null,
      Date.now(),
      runId,
    );
  }

  listRuns(scheduleId: string): ScheduleRunInfo[] {
    return (this.#statements.listRuns.all(scheduleId) as unknown as ScheduleRunRow[])
      .map(fromScheduleRunRow);
  }

  delete(id: string): void {
    this.#statements.delete.run(id);
  }

  close(): void {
    this.#db.close();
  }
}

function fromScheduleRow(row: ScheduleRow): ScheduleInfo {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    trigger: JSON.parse(row.trigger_json) as ScheduleTrigger,
    target: row.target,
    status: row.status,
    notificationPolicy: row.notification_policy,
    sourceSessionId: row.source_session_id,
    agentId: row.agent_id,
    cwd: row.cwd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
  };
}

function fromScheduleRunRow(row: ScheduleRunRow): ScheduleRunInfo {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    sessionId: row.session_id,
    error: row.error,
  };
}
