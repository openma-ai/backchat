import type { ScheduleTrigger } from "../shared/schedules.js";
import { CronExpressionParser } from "cron-parser";
import { rrulestr } from "rrule";

export function nextScheduleRun(
  trigger: ScheduleTrigger,
  after: number,
  anchor = after,
): number | null {
  if (trigger.type === "at") {
    const at = Date.parse(trigger.at);
    return Number.isFinite(at) && at > after ? at : null;
  }
  if (trigger.type === "interval") {
    if (!Number.isFinite(trigger.everyMs) || trigger.everyMs <= 0) return null;
    const elapsed = Math.max(0, after - anchor);
    return anchor + (Math.floor(elapsed / trigger.everyMs) + 1) * trigger.everyMs;
  }
  if (trigger.type === "cron") {
    return nextCronRun(trigger.expression, trigger.timezone, after);
  }
  return nextRruleRun(trigger.rule, trigger.timezone, after, anchor);
}

function nextCronRun(expression: string, timezone: string, after: number): number | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Cron expressions must contain five fields");
  return CronExpressionParser.parse(expression, {
    currentDate: new Date(after),
    tz: timezone,
  }).next().getTime();
}

function localDateTimeValue(at: number, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(at)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

function nextRruleRun(
  source: string,
  timezone: string,
  after: number,
  anchor: number,
): number | null {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("RRULE is required");
  const hasStart = /(?:^|\n)DTSTART(?:;|:)/i.test(trimmed);
  const hasPrefix = /(?:^|\n)RRULE:/i.test(trimmed);
  const body = hasPrefix ? trimmed : `RRULE:${trimmed}`;
  const serialized = hasStart
    ? body
    : `DTSTART:${localDateTimeValue(anchor, timezone)}\n${body}`;
  const floatingAfter = zonedInstantToFloatingDate(after, timezone);
  const occurrence = rrulestr(serialized).after(floatingAfter, false);
  return occurrence ? floatingDateToZonedInstant(occurrence, timezone) : null;
}

function zonedInstantToFloatingDate(at: number, timezone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(at)).map((part) => [part.type, part.value]),
  );
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  ));
}

function floatingDateToZonedInstant(floating: Date, timezone: string): number {
  const target = Date.UTC(
    floating.getUTCFullYear(),
    floating.getUTCMonth(),
    floating.getUTCDate(),
    floating.getUTCHours(),
    floating.getUTCMinutes(),
    floating.getUTCSeconds(),
  );
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedInstantToFloatingDate(candidate, timezone).getTime();
    const correction = target - observed;
    candidate += correction;
    if (correction === 0) break;
  }
  return candidate;
}
