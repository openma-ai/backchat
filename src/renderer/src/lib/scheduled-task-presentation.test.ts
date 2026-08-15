import { describe, expect, it } from "vitest";

import type { ScheduleInfo } from "@shared/schedules.js";
import {
  formatListedTaskNames,
  formatScheduleFrequency,
  formatScheduleListMeta,
  isScheduleCreateTool,
  liveSchedulesForSessions,
  parseScheduledTaskPrompt,
  scheduleArchiveCopyKind,
  scheduleRowsForTab,
  scheduleSourceSessionLabel,
  scheduledSourceSessionIds,
  schedulesCreatedByTools,
  visibleSchedulePageRows,
  wrapScheduledTaskPrompt,
} from "./scheduled-task-presentation";

function schedule(overrides: Partial<ScheduleInfo> = {}): ScheduleInfo {
  return {
    id: "sched-1",
    name: "2分钟后提醒",
    prompt: "check in",
    trigger: { type: "interval", everyMs: 60_000 },
    target: "current_task",
    status: "active",
    notificationPolicy: "always",
    sourceSessionId: "sess-1",
    agentId: "dsh-acp",
    cwd: "/tmp",
    createdAt: 1,
    updatedAt: 1,
    nextRunAt: 2,
    lastRunAt: null,
    ...overrides,
  };
}

describe("scheduled task presentation", () => {
  it("marks source sessions that still have a live schedule", () => {
    expect(scheduledSourceSessionIds([
      schedule(),
      schedule({ id: "done", sourceSessionId: "sess-2", status: "completed" }),
      schedule({ id: "paused", sourceSessionId: "sess-3", status: "paused" }),
    ])).toEqual(new Set(["sess-1", "sess-3"]));
  });

  it("lists live schedules for the sessions being archived", () => {
    expect(liveSchedulesForSessions([
      schedule(),
      schedule({ id: "other", sourceSessionId: "sess-2", name: "other" }),
      schedule({ id: "done", status: "completed" }),
      schedule({ id: "paused", status: "paused", name: "paused alarm" }),
    ], ["sess-1"])).toEqual([
      expect.objectContaining({ id: "sched-1" }),
      expect.objectContaining({ id: "paused", name: "paused alarm" }),
    ]);
  });

  it("hides completed schedules from the schedule page", () => {
    expect(visibleSchedulePageRows([
      schedule(),
      schedule({ id: "done", status: "completed" }),
      schedule({ id: "paused", status: "paused" }),
    ]).map((item) => item.id)).toEqual(["sched-1", "paused"]);
  });

  it("filters the schedule page by All, Active, and Paused tabs", () => {
    const rows = [
      schedule(),
      schedule({ id: "done", status: "completed" }),
      schedule({ id: "paused", status: "paused" }),
    ];
    expect(scheduleRowsForTab(rows, "all").map((item) => item.id)).toEqual(["sched-1", "paused"]);
    expect(scheduleRowsForTab(rows, "active").map((item) => item.id)).toEqual(["sched-1"]);
    expect(scheduleRowsForTab(rows, "paused").map((item) => item.id)).toEqual(["paused"]);
  });

  it("joins frequency and relative next run for the wireless list row", () => {
    expect(formatScheduleListMeta(
      schedule({
        trigger: {
          type: "rrule",
          rule: "RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=0",
          timezone: "UTC",
        },
        nextRunAt: Date.parse("2026-08-16T07:00:00.000Z"),
      }),
      "en",
      Date.parse("2026-08-15T22:00:00.000Z"),
    )).toBe("Daily at 7:00 AM · Next run in 9 hours");
  });

  it("picks archive-warning copy for one task, many tasks, or many chats", () => {
    expect(scheduleArchiveCopyKind(1, 1)).toBe("task");
    expect(scheduleArchiveCopyKind(1, 2)).toBe("tasks");
    expect(scheduleArchiveCopyKind(3, 1)).toBe("chats");
  });

  it("joins task names and falls back to a short session id for the backlink", () => {
    expect(formatListedTaskNames(["每天7点闹钟", "Weekly review"], "zh-CN"))
      .toBe("每天7点闹钟、Weekly review");
    expect(formatListedTaskNames(["每天7点闹钟", "Weekly review"], "en"))
      .toBe("每天7点闹钟, Weekly review");
    expect(scheduleSourceSessionLabel(
      [{ id: "sess-long-id", title: "Morning brief" }],
      "sess-long-id",
    )).toBe("Morning brief");
    expect(scheduleSourceSessionLabel([], "sess-long-id")).toBe("sess-lon");
  });

  it("recognizes MCP schedule_create tools even when namespaced", () => {
    expect(isScheduleCreateTool({ toolName: "schedule_create" })).toBe(true);
    expect(isScheduleCreateTool({ title: "Create schedule" })).toBe(true);
    expect(isScheduleCreateTool({
      toolName: "mcp__openma-schedules__schedule_create",
    })).toBe(true);
    expect(isScheduleCreateTool({ title: "Read" })).toBe(false);
  });

  it("extracts created schedule cards from completed tool output", () => {
    expect(schedulesCreatedByTools([
      {
        title: "Read",
        status: "completed",
        rawOutput: JSON.stringify(schedule()),
      },
      {
        toolName: "schedule_create",
        status: "completed",
        rawOutput: JSON.stringify(schedule({
          id: "sched-daily",
          name: "每天7点闹钟",
          trigger: {
            type: "rrule",
            rule: "RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=0",
            timezone: "Asia/Shanghai",
          },
        })),
      },
      {
        title: "Create schedule",
        status: "completed",
        rawInput: {
          name: "2分钟后提醒",
          trigger: { type: "interval", everyMs: 60_000 },
        },
        content: [{
          type: "content",
          content: {
            type: "text",
            text: JSON.stringify(schedule()),
          },
        }],
      },
    ])).toEqual([
      {
        id: "sched-daily",
        name: "每天7点闹钟",
        trigger: {
          type: "rrule",
          rule: "RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=0",
          timezone: "Asia/Shanghai",
        },
        prompt: "check in",
      },
      {
        id: "sched-1",
        name: "2分钟后提醒",
        trigger: { type: "interval", everyMs: 60_000 },
        prompt: "check in",
      },
    ]);
  });

  it("formats interval and daily RRULE frequencies for the message bar", () => {
    expect(formatScheduleFrequency(
      { type: "interval", everyMs: 60_000 },
      "en",
    )).toBe("Every minute");
    expect(formatScheduleFrequency(
      { type: "interval", everyMs: 60_000 },
      "zh-CN",
    )).toBe("每分钟");
    expect(formatScheduleFrequency({
      type: "rrule",
      rule: "RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=0",
      timezone: "UTC",
    }, "en")).toBe("Daily at 7:00 AM");
  });

  it("wraps a scheduled fire in a user-message tag the renderer can parse", () => {
    const wrapped = wrapScheduledTaskPrompt({
      id: "sched-1",
      name: '每天7点"闹钟"',
      prompt: "提醒用户：你刚才说要办的事，现在 21:54 到了，别忘了！",
    });

    expect(wrapped).toContain("<scheduled_task");
    expect(wrapped).toContain("</scheduled_task>");
    expect(parseScheduledTaskPrompt(wrapped)).toEqual({
      id: "sched-1",
      name: '每天7点"闹钟"',
      prompt: "提醒用户：你刚才说要办的事，现在 21:54 到了，别忘了！",
    });
    expect(parseScheduledTaskPrompt("普通用户消息")).toBeNull();
  });
});
