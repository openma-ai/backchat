import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduleService } from "./schedule-service.js";
import { ScheduleStore } from "./schedule-store.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ScheduleService", () => {
  it("binds a harness-created schedule to the calling task", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedule-service-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));
    const reschedule = vi.fn();
    const service = new ScheduleService({
      store,
      findSession: (id) => id === "task-1"
        ? { agent_id: "claude-acp", cwd: "/tmp/project" }
        : null,
      reschedule,
    });

    const created = await service.create("task-1", {
      name: "Wake up",
      prompt: "Tell me to wake up",
      target: "current_task",
      trigger: { type: "at", at: "2026-07-20T10:00:00+08:00" },
    });

    expect(created).toMatchObject({
      sourceSessionId: "task-1",
      agentId: "claude-acp",
      cwd: "/tmp/project",
    });
    expect(await service.list("task-1")).toEqual([created]);
    expect(reschedule).toHaveBeenCalledOnce();
    store.close();
  });

  it("prevents one task from updating another task's schedule", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedule-service-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));
    const service = new ScheduleService({
      store,
      findSession: (id) => ({ agent_id: "codex-acp", cwd: `/tmp/${id}` }),
      reschedule: vi.fn(),
    });
    const created = await service.create("task-1", {
      name: "Private",
      prompt: "Run",
      target: "current_task",
      trigger: { type: "at", at: "2026-07-20T10:00:00+08:00" },
    });

    await expect(service.update("task-2", {
      id: created.id,
      status: "paused",
    })).rejects.toThrow("does not belong to task");
    store.close();
  });

  it("deletes only a schedule owned by the calling task", async () => {
    const root = await mkdtemp(join(tmpdir(), "openma-schedule-service-"));
    roots.push(root);
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-19T01:00:00.000Z");
    const store = new ScheduleStore(join(root, "schedules.db"));
    const service = new ScheduleService({
      store,
      findSession: (id) => ({ agent_id: "codex-acp", cwd: `/tmp/${id}` }),
      reschedule: vi.fn(),
    });
    const created = await service.create("task-1", {
      name: "Disposable",
      prompt: "Run",
      target: "current_task",
      trigger: { type: "at", at: "2026-07-20T10:00:00+08:00" },
    });

    await service.delete("task-1", created.id);

    expect(store.get(created.id)).toBeNull();
    store.close();
  });
});
