import type { ScheduleTrigger } from "@shared/schedules.js";

export interface ScheduleTriggerDraft {
  type: "at" | "interval" | "cron" | "rrule";
  value: string;
  timezone: string;
}

export function buildScheduleTrigger(draft: ScheduleTriggerDraft): ScheduleTrigger {
  if (draft.type === "interval") {
    const minutes = Number(draft.value);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error("Interval must be greater than zero");
    }
    return { type: "interval", everyMs: minutes * 60_000 };
  }
  if (draft.type === "cron") {
    return {
      type: "cron",
      expression: draft.value.trim(),
      timezone: draft.timezone,
    };
  }
  if (draft.type === "rrule") {
    return {
      type: "rrule",
      rule: draft.value.trim(),
      timezone: draft.timezone,
    };
  }
  const match = draft.value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Choose a valid date and time");
  const [, year, month, day, hour, minute] = match;
  const wallClock = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  let instant = wallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = floatingLocalTime(instant, draft.timezone);
    const correction = wallClock - observed;
    instant += correction;
    if (correction === 0) break;
  }
  return { type: "at", at: new Date(instant).toISOString() };
}

function floatingLocalTime(at: number, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(at)).map((part) => [part.type, part.value]),
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
}
