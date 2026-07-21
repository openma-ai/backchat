import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduleEngine } from "./schedule-engine.js";
import { ScheduleStore } from "./schedule-store.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ScheduleEngine", () => {
  it("executes a due schedule and records the created task", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedule-engine-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));
    const schedule = store.create({
      name: "Wake up",
      prompt: "Wake up",
      trigger: { type: "at", at: "2026-07-20T10:00:00+08:00" },
      target: "new_task",
      sourceSessionId: "task-1",
      agentId: "codex-acp",
      cwd: "/tmp/project",
    });
    const execute = vi.fn(async () => ({ sessionId: "scheduled-task-1" }));
    const engine = new ScheduleEngine({ store, execute });
    const dueAt = Date.parse("2026-07-20T02:00:00.000Z");
    vi.setSystemTime(dueAt);

    await engine.runDue(dueAt);

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ id: schedule.id }));
    expect(store.listRuns(schedule.id)[0]).toMatchObject({
      status: "succeeded",
      sessionId: "scheduled-task-1",
    });
    store.close();
  });

  it("notifies when a scheduled task fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedule-engine-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));
    const schedule = store.create({
      name: "Build check",
      prompt: "Check build",
      trigger: { type: "at", at: "2026-07-20T10:00:00+08:00" },
      target: "current_task",
      sourceSessionId: "task-1",
      agentId: "codex-acp",
      cwd: "/tmp/project",
      notificationPolicy: "failures",
    });
    const notify = vi.fn();
    const engine = new ScheduleEngine({
      store,
      execute: vi.fn(async () => { throw new Error("Harness unavailable"); }),
      notify,
    });
    const dueAt = Date.parse("2026-07-20T02:00:00.000Z");
    vi.setSystemTime(dueAt);

    await engine.runDue(dueAt);

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      title: "Build check failed",
      body: "Harness unavailable",
      scheduleId: schedule.id,
    }));
    expect(store.listRuns(schedule.id)[0]).toMatchObject({ status: "failed" });
    store.close();
  });

  it("wakes itself for the next scheduled run", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedule-engine-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));
    store.create({
      name: "Soon",
      prompt: "Run soon",
      trigger: { type: "at", at: "2026-07-19T01:00:10.000Z" },
      target: "current_task",
      sourceSessionId: "task-1",
      agentId: "codex-acp",
      cwd: "/tmp/project",
    });
    const execute = vi.fn(async () => ({ sessionId: "task-1" }));
    const engine = new ScheduleEngine({ store, execute });

    engine.start();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(execute).toHaveBeenCalledTimes(1);
    engine.stop();
    store.close();
  });
});
