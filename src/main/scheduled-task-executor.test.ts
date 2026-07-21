import { describe, expect, it, vi } from "vitest";

import { ScheduledTaskExecutor } from "./scheduled-task-executor.js";
import type { ScheduleInfo } from "../shared/schedules.js";

function schedule(overrides: Partial<ScheduleInfo> = {}): ScheduleInfo {
  return {
    id: "schedule-1",
    name: "Follow up",
    prompt: "Check the deployment",
    trigger: { type: "interval", everyMs: 60_000 },
    target: "current_task",
    status: "active",
    notificationPolicy: "always",
    sourceSessionId: "task-1",
    agentId: "codex-acp",
    cwd: "/tmp/project",
    createdAt: 1,
    updatedAt: 1,
    nextRunAt: 2,
    lastRunAt: null,
    ...overrides,
  };
}

describe("ScheduledTaskExecutor", () => {
  it("resumes and prompts the source task for a current-task schedule", async () => {
    const start = vi.fn(async () => ({ status: "ready" as const }));
    const prompt = vi.fn(async () => undefined);
    const executor = new ScheduledTaskExecutor({
      start,
      prompt,
      findSession: () => ({ acp_session_id: "acp-task-1" }),
      createId: () => "turn-1",
    });

    await executor.execute(schedule());

    expect(start).toHaveBeenCalledWith({
      session_id: "task-1",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
      resume: { acp_session_id: "acp-task-1" },
    });
    expect(prompt).toHaveBeenCalledWith({
      session_id: "task-1",
      turn_id: "turn-1",
      text: "Check the deployment",
    });
  });

  it("creates an independent task with the same harness and project", async () => {
    const start = vi.fn(async () => ({ status: "ready" as const }));
    const prompt = vi.fn(async () => undefined);
    const createId = vi.fn()
      .mockReturnValueOnce("scheduled-task-1")
      .mockReturnValueOnce("turn-1");
    const executor = new ScheduledTaskExecutor({
      start,
      prompt,
      findSession: () => ({ acp_session_id: "acp-task-1" }),
      createId,
    });

    const result = await executor.execute(schedule({ target: "new_task" }));

    expect(result).toEqual({ sessionId: "scheduled-task-1" });
    expect(start).toHaveBeenCalledWith({
      session_id: "scheduled-task-1",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
      workspace_mode: "project",
    });
    expect(prompt).toHaveBeenCalledWith({
      session_id: "scheduled-task-1",
      turn_id: "turn-1",
      text: "Check the deployment",
    });
  });
});
