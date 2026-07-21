import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduleStore } from "./schedule-store.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ScheduleStore", () => {
  it("persists a one-time task with its next run", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedules-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));

    const created = store.create({
      name: "Wake up",
      prompt: "Tell me to wake up",
      trigger: { type: "at", at: "2026-07-20T10:00:00+08:00" },
      target: "current_task",
      sourceSessionId: "task-1",
      agentId: "codex-acp",
      cwd: "/tmp/project",
    });

    expect(created).toMatchObject({
      name: "Wake up",
      status: "active",
      nextRunAt: Date.parse("2026-07-20T02:00:00.000Z"),
      sourceSessionId: "task-1",
    });
    expect(store.list()).toEqual([created]);
    store.close();
  });

  it("pauses an active schedule and clears its next run", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedules-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));
    const created = store.create({
      name: "Daily check",
      prompt: "Check the build",
      trigger: { type: "cron", expression: "0 10 * * *", timezone: "Asia/Shanghai" },
      target: "new_task",
      sourceSessionId: "task-1",
      agentId: "claude-acp",
      cwd: "/tmp/project",
    });

    expect(store.update({ id: created.id, status: "paused" })).toMatchObject({
      status: "paused",
      nextRunAt: null,
    });
    store.close();
  });

  it("claims a due one-time schedule exactly once", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedules-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));
    const created = store.create({
      name: "Wake up",
      prompt: "Wake up",
      trigger: { type: "at", at: "2026-07-20T10:00:00+08:00" },
      target: "current_task",
      sourceSessionId: "task-1",
      agentId: "codex-acp",
      cwd: "/tmp/project",
    });
    const dueAt = Date.parse("2026-07-20T02:00:00.000Z");

    expect(store.due(dueAt)).toEqual([created]);
    const claimed = store.beginRun(created.id, dueAt);

    expect(claimed?.schedule).toMatchObject({ status: "completed", nextRunAt: null });
    expect(claimed?.run).toMatchObject({ status: "running", scheduledFor: dueAt });
    expect(store.due(dueAt)).toEqual([]);
    store.close();
  });

  it("records the task and outcome of a schedule run", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedules-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));
    const created = store.create({
      name: "Wake up",
      prompt: "Wake up",
      trigger: { type: "at", at: "2026-07-20T10:00:00+08:00" },
      target: "new_task",
      sourceSessionId: "task-1",
      agentId: "codex-acp",
      cwd: "/tmp/project",
    });
    const dueAt = Date.parse("2026-07-20T02:00:00.000Z");
    const claimed = store.beginRun(created.id, dueAt)!;
    vi.setSystemTime(dueAt);

    store.finishRun(claimed.run.id, {
      status: "succeeded",
      sessionId: "scheduled-task-1",
    });

    expect(store.listRuns(created.id)).toEqual([
      expect.objectContaining({
        id: claimed.run.id,
        status: "succeeded",
        sessionId: "scheduled-task-1",
        finishedAt: dueAt,
      }),
    ]);
    store.close();
  });

  it("deletes a schedule and its run history", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedules-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));
    const created = store.create({
      name: "Disposable",
      prompt: "Run once",
      trigger: { type: "at", at: "2026-07-20T10:00:00+08:00" },
      target: "current_task",
      sourceSessionId: "task-1",
      agentId: "codex-acp",
      cwd: "/tmp/project",
    });

    store.delete(created.id);

    expect(store.get(created.id)).toBeNull();
    expect(store.listRuns(created.id)).toEqual([]);
    store.close();
  });

  it("skips missed recurring intervals instead of replaying a backlog", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedules-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));
    const created = store.create({
      name: "Frequent check",
      prompt: "Check once after restart",
      trigger: { type: "interval", everyMs: 15 * 60_000 },
      target: "current_task",
      sourceSessionId: "task-1",
      agentId: "codex-acp",
      cwd: "/tmp/project",
    });
    const restartedAt = Date.parse("2026-07-19T02:00:00.000Z");

    const claimed = store.beginRun(created.id, restartedAt);

    expect(claimed?.schedule.nextRunAt).toBe(Date.parse("2026-07-19T02:15:00.000Z"));
    store.close();
  });
});
