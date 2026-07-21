export type ScheduleTrigger =
  | {
      type: "at";
      /** ISO 8601 timestamp with an explicit UTC offset. */
      at: string;
    }
  | {
      type: "interval";
      everyMs: number;
    }
  | {
      type: "cron";
      /** Standard five-field cron: minute hour day-of-month month day-of-week. */
      expression: string;
      timezone: string;
    }
  | {
      type: "rrule";
      /** RFC 5545 RRULE value, with or without the RRULE: prefix/DTSTART line. */
      rule: string;
      timezone: string;
    };

export type ScheduleStatus = "active" | "paused" | "completed";
export type ScheduleTarget = "current_task" | "new_task";
export type ScheduleNotificationPolicy = "always" | "failures" | "never";

export interface ScheduleInfo {
  id: string;
  name: string;
  prompt: string;
  trigger: ScheduleTrigger;
  target: ScheduleTarget;
  status: ScheduleStatus;
  notificationPolicy: ScheduleNotificationPolicy;
  sourceSessionId: string;
  agentId: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
}

export interface CreateScheduleInput {
  name: string;
  prompt: string;
  trigger: ScheduleTrigger;
  target: ScheduleTarget;
  sourceSessionId: string;
  agentId: string;
  cwd: string;
  notificationPolicy?: ScheduleNotificationPolicy;
}

export interface UpdateScheduleInput {
  id: string;
  name?: string;
  prompt?: string;
  trigger?: ScheduleTrigger;
  target?: ScheduleTarget;
  status?: Exclude<ScheduleStatus, "completed">;
  notificationPolicy?: ScheduleNotificationPolicy;
}

export interface ScheduleRunInfo {
  id: string;
  scheduleId: string;
  scheduledFor: number;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "succeeded" | "failed";
  sessionId: string | null;
  error: string | null;
}
